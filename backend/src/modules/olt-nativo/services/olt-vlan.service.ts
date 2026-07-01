import {
  ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OltVlan } from '../entities/olt-vlan.entity';
import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { decrypt } from '../../../common/utils/encryption.util';

export class AgregarVlanDto {
  @IsInt() @Min(1) @Max(4094) @Type(() => Number) vlanId:      number;
  @IsString() @MaxLength(64)                       nombre:      string;
  @IsOptional() @IsString()                        descripcion?: string;
}

@Injectable()
export class OltVlanService {
  private readonly logger = new Logger(OltVlanService.name);

  constructor(
    @InjectRepository(OltVlan)
    private readonly repo: Repository<OltVlan>,
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,
    private readonly automation: OltAutomationClient,
    private readonly ds: DataSource,
  ) {}

  async listar(oltId: string, empresaId: string): Promise<OltVlan[]> {
    return this.repo.find({
      where: { oltId, empresaId },
      order: { vlanId: 'ASC' },
    });
  }

  // ── Agregar solo en BD (wizard import, sin push a CLI) ───────
  async agregar(oltId: string, empresaId: string, dto: AgregarVlanDto): Promise<OltVlan> {
    const existente = await this.repo.findOne({ where: { oltId, vlanId: dto.vlanId } });
    if (existente) throw new ConflictException(`VLAN ${dto.vlanId} ya existe para esta OLT.`);
    const vlan = this.repo.create({
      oltId, empresaId,
      vlanId:      dto.vlanId,
      nombre:      dto.nombre,
      descripcion: dto.descripcion ?? null,
      origen:      'erp',
      estado:      'active',
    });
    return this.repo.save(vlan);
  }

  // ── Agregar atómico: BD (syncing) → CLI → BD (active/rollback) ─
  async agregarConCli(oltId: string, empresaId: string, dto: AgregarVlanDto): Promise<OltVlan> {
    const existente = await this.repo.findOne({ where: { oltId, vlanId: dto.vlanId } });
    if (existente) throw new ConflictException(`VLAN ${dto.vlanId} ya existe para esta OLT.`);

    const olt  = await this._fetchOlt(oltId, empresaId);
    const conn = this._buildConn(olt);

    // 1. Reservar en BD con estado syncing
    const vlan = await this.repo.save(this.repo.create({
      oltId, empresaId,
      vlanId:      dto.vlanId,
      nombre:      dto.nombre,
      descripcion: dto.descripcion ?? null,
      origen:      'erp',
      estado:      'syncing',
    }));

    // 2. Push a CLI
    let cliOk = false;
    try {
      const res = await this.automation.vlanAdd({ connection: conn, vlan_id: dto.vlanId, name: dto.nombre });
      cliOk = res.success;
      if (!cliOk) {
        await this.repo.remove(vlan);
        throw new UnprocessableEntityException(`CLI rechazó VLAN ${dto.vlanId}: ${res.error}`);
      }
    } catch (err: any) {
      if (err instanceof UnprocessableEntityException) throw err;
      await this.repo.remove(vlan);
      throw new ServiceUnavailableException(`Fallo SSH al agregar VLAN ${dto.vlanId}: ${err.message}`);
    }

    // 3. Confirmar en BD
    await this.repo.update(vlan.id, { estado: 'active' });
    return { ...vlan, estado: 'active' };
  }

  // ── Eliminar solo en BD ──────────────────────────────────────
  async eliminar(oltId: string, empresaId: string, vlanId: number): Promise<void> {
    const vlan = await this.repo.findOne({ where: { oltId, empresaId, vlanId } });
    if (!vlan) throw new NotFoundException(`VLAN ${vlanId} no encontrada.`);
    await this.repo.remove(vlan);
  }

  // ── Eliminar atómico con guard de integridad + CLI ───────────
  async eliminarConCli(oltId: string, empresaId: string, vlanId: number): Promise<void> {
    const vlan = await this.repo.findOne({ where: { oltId, empresaId, vlanId } });
    if (!vlan) throw new NotFoundException(`VLAN ${vlanId} no encontrada.`);

    // Guard: verificar que no haya ONUs usando esta VLAN
    const [{ count }] = await this.ds.query<[{ count: string }]>(
      `SELECT COUNT(*) AS count
       FROM ftth_onu_registro
       WHERE olt_id = $1 AND vlan = $2 AND deleted_at IS NULL`,
      [oltId, vlanId],
    );
    if (Number(count) > 0) {
      throw new ConflictException(
        `No se puede eliminar la VLAN ${vlanId}: ${count} ONU(s) activa(s) la están usando.`,
      );
    }

    const olt  = await this._fetchOlt(oltId, empresaId);
    const conn = this._buildConn(olt);

    // Mark syncing
    await this.repo.update(vlan.id, { estado: 'syncing' });

    try {
      const res = await this.automation.vlanDelete({ connection: conn, vlan_id: vlanId });
      if (!res.success) {
        await this.repo.update(vlan.id, { estado: 'error' });
        throw new UnprocessableEntityException(`CLI rechazó eliminación VLAN ${vlanId}: ${res.error}`);
      }
    } catch (err: any) {
      if (err instanceof UnprocessableEntityException) throw err;
      await this.repo.update(vlan.id, { estado: 'error' });
      throw new ServiceUnavailableException(`Fallo SSH al eliminar VLAN ${vlanId}: ${err.message}`);
    }

    await this.repo.remove(vlan);
  }

  // ── Editar nombre (BD only — VLAN ID y número no cambian) ────
  async editarNombre(oltId: string, empresaId: string, vlanId: number, nombre: string): Promise<OltVlan> {
    const vlan = await this.repo.findOne({ where: { oltId, empresaId, vlanId } });
    if (!vlan) throw new NotFoundException(`VLAN ${vlanId} no encontrada.`);
    await this.repo.update(vlan.id, { nombre });
    return { ...vlan, nombre };
  }

  // ── Pull masivo: sincronizar desde OLT hardware → BD ─────────
  async pullDesdeOlt(
    oltId:     string,
    empresaId: string,
  ): Promise<{ insertadas: number; omitidas: number }> {
    const olt     = await this._fetchOlt(oltId, empresaId);
    const conn    = this._buildConn(olt);
    const perfiles = await this.automation.listProfiles({ connection: conn });

    if (!perfiles.success) {
      throw new ServiceUnavailableException(`Fallo al leer perfiles de OLT: ${perfiles.error}`);
    }

    const vlans = (perfiles as any).vlans as Array<{ vlan_id: number; name: string }> | undefined ?? [];
    if (vlans.length === 0) return { insertadas: 0, omitidas: 0 };

    return this.sincronizarDesdeArray(
      oltId, empresaId,
      vlans.map(v => ({ vlan_id: v.vlan_id, nombre: v.name })),
      'olt',
    );
  }

  // ── Sincronización masiva UPSERT ─────────────────────────────
  async sincronizarDesdeArray(
    oltId:     string,
    empresaId: string,
    vlans:     Array<{ vlan_id: number; nombre: string }>,
    origen:    'erp' | 'olt' = 'olt',
  ): Promise<{ insertadas: number; omitidas: number }> {
    if (vlans.length === 0) return { insertadas: 0, omitidas: 0 };

    const ids    = vlans.map(v => v.vlan_id);
    const names  = vlans.map(v => v.nombre);

    const [row] = await this.repo.manager.query<[{ insertadas: string }]>(
      `WITH upserted AS (
         INSERT INTO olt_vlans
           (id, olt_id, empresa_id, vlan_id, nombre, origen, estado, created_at, updated_at)
         SELECT gen_random_uuid(), $1, $2, t.vid, t.name, $5, 'active', NOW(), NOW()
         FROM   unnest($3::int[], $4::text[]) AS t(vid, name)
         ON CONFLICT (olt_id, vlan_id) DO NOTHING
         RETURNING 1
       )
       SELECT COUNT(*) AS insertadas FROM upserted`,
      [oltId, empresaId, ids, names, origen],
    );

    const insertadas = Number(row.insertadas);
    this.logger.log(`VLAN sync olt=${oltId}: ${insertadas} insertadas, ${vlans.length - insertadas} omitidas`);
    return { insertadas, omitidas: vlans.length - insertadas };
  }

  // ── Privados ──────────────────────────────────────────────────
  private async _fetchOlt(oltId: string, empresaId: string): Promise<OltDispositivo> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada.`);
    return olt;
  }

  private _buildConn(olt: OltDispositivo) {
    let password: string;
    try {
      password = decrypt(olt.contrasenaCifrada);
    } catch {
      throw new ServiceUnavailableException(`No se pudo descifrar la contraseña de la OLT "${olt.nombre}".`);
    }
    return {
      ip:       olt.ipGestion,
      port:     olt.puerto,
      username: olt.usuarioAnclado,
      password,
      brand:    olt.marca,
    };
  }
}
