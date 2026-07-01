import {
  ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OltTrafficTable, TrafficTableTipo } from '../entities/olt-traffic-table.entity';
import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { decrypt } from '../../../common/utils/encryption.util';

export class AgregarTrafficTableDto {
  @IsString() @MaxLength(64)                       nombre:   string;
  @IsInt() @Min(64) @Max(10_000_000) @Type(() => Number) cirKbps: number;
  @IsInt() @Min(64) @Max(10_000_000) @Type(() => Number) pirKbps: number;
  @IsOptional() @IsString()                        tipo?:    TrafficTableTipo;
}

export class EditarTrafficTableDto {
  @IsString() @MaxLength(64)                       nombre:   string;
  @IsInt() @Min(64) @Max(10_000_000) @Type(() => Number) cirKbps: number;
  @IsInt() @Min(64) @Max(10_000_000) @Type(() => Number) pirKbps: number;
  @IsOptional() @IsString()                        tipo?:    TrafficTableTipo;
}

@Injectable()
export class OltTrafficTableService {
  private readonly logger = new Logger(OltTrafficTableService.name);

  constructor(
    @InjectRepository(OltTrafficTable)
    private readonly repo: Repository<OltTrafficTable>,
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,
    private readonly automation: OltAutomationClient,
    private readonly ds: DataSource,
  ) {}

  async listar(oltId: string, empresaId: string): Promise<OltTrafficTable[]> {
    return this.repo.find({
      where: { oltId, empresaId },
      order: { trafficId: 'ASC' },
    });
  }

  // ── Agregar atómico: CLI → BD ─────────────────────────────────
  // El índice lo asigna la OLT; se guarda el que Python retorna.
  async agregarConCli(
    oltId:     string,
    empresaId: string,
    dto:       AgregarTrafficTableDto,
  ): Promise<OltTrafficTable> {
    const olt  = await this._fetchOlt(oltId, empresaId);
    const conn = this._buildConn(olt);

    const res = await this.automation.trafficTableAdd({
      connection: conn,
      name:       dto.nombre,
      cir_kbps:   dto.cirKbps,
      pir_kbps:   dto.pirKbps,
    });

    if (!res.success) {
      throw new UnprocessableEntityException(`CLI rechazó traffic table "${dto.nombre}": ${res.error}`);
    }
    if (res.index == null) {
      throw new ServiceUnavailableException(`OLT creó la tabla "${dto.nombre}" pero no retornó índice.`);
    }

    const existente = await this.repo.findOne({ where: { oltId, trafficId: res.index } });
    if (existente) {
      await this.repo.update(existente.id, {
        nombre:  dto.nombre,
        cirKbps: dto.cirKbps,
        pirKbps: dto.pirKbps,
        tipo:    dto.tipo ?? 'combinado',
        origen:  'erp',
        estado:  'active',
      });
      return { ...existente, nombre: dto.nombre, cirKbps: dto.cirKbps, pirKbps: dto.pirKbps };
    }

    return this.repo.save(this.repo.create({
      oltId, empresaId,
      trafficId: res.index,
      nombre:    res.name ?? dto.nombre,
      cirKbps:   dto.cirKbps,
      pirKbps:   dto.pirKbps,
      tipo:      dto.tipo ?? 'combinado',
      origen:    'erp',
      estado:    'active',
    }));
  }

  // ── Editar atómico con guard: CLI (delete+recreate) → BD ─────
  async editarConCli(
    oltId:     string,
    empresaId: string,
    trafficId: number,
    dto:       EditarTrafficTableDto,
  ): Promise<OltTrafficTable> {
    const tt = await this.repo.findOne({ where: { oltId, empresaId, trafficId } });
    if (!tt) throw new NotFoundException(`Traffic table ${trafficId} no encontrada.`);

    // Guard de integridad
    await this._assertNoOnusEnUso(oltId, trafficId);

    const olt  = await this._fetchOlt(oltId, empresaId);
    const conn = this._buildConn(olt);

    await this.repo.update(tt.id, { estado: 'syncing' });

    let res;
    try {
      res = await this.automation.trafficTableEdit({
        connection: conn,
        index:      trafficId,
        name:       dto.nombre,
        cir_kbps:   dto.cirKbps,
        pir_kbps:   dto.pirKbps,
      });
    } catch (err: any) {
      await this.repo.update(tt.id, { estado: 'error' });
      throw new ServiceUnavailableException(`Fallo SSH al editar traffic table ${trafficId}: ${err.message}`);
    }

    if (!res.success) {
      await this.repo.update(tt.id, { estado: 'error' });
      throw new UnprocessableEntityException(`CLI rechazó edición de traffic table ${trafficId}: ${res.error}`);
    }

    const newTrafficId = res.new_index ?? trafficId;
    await this.repo.update(tt.id, {
      trafficId: newTrafficId,
      nombre:    dto.nombre,
      cirKbps:   dto.cirKbps,
      pirKbps:   dto.pirKbps,
      tipo:      dto.tipo ?? tt.tipo,
      estado:    'active',
    });
    return { ...tt, trafficId: newTrafficId, nombre: dto.nombre, cirKbps: dto.cirKbps, pirKbps: dto.pirKbps, estado: 'active' };
  }

  // ── Eliminar solo en BD ──────────────────────────────────────
  async eliminar(oltId: string, empresaId: string, trafficId: number): Promise<void> {
    const t = await this.repo.findOne({ where: { oltId, empresaId, trafficId } });
    if (!t) throw new NotFoundException(`Traffic table ${trafficId} no encontrada.`);
    await this.repo.remove(t);
  }

  // ── Eliminar atómico con guard + CLI ────────────────────────
  async eliminarConCli(oltId: string, empresaId: string, trafficId: number): Promise<void> {
    const tt = await this.repo.findOne({ where: { oltId, empresaId, trafficId } });
    if (!tt) throw new NotFoundException(`Traffic table ${trafficId} no encontrada.`);

    await this._assertNoOnusEnUso(oltId, trafficId);

    const olt  = await this._fetchOlt(oltId, empresaId);
    const conn = this._buildConn(olt);

    await this.repo.update(tt.id, { estado: 'syncing' });

    try {
      const res = await this.automation.trafficTableDelete({ connection: conn, index: trafficId });
      if (!res.success) {
        await this.repo.update(tt.id, { estado: 'error' });
        throw new UnprocessableEntityException(`CLI rechazó eliminación de traffic table ${trafficId}: ${res.error}`);
      }
    } catch (err: any) {
      if (err instanceof UnprocessableEntityException) throw err;
      await this.repo.update(tt.id, { estado: 'error' });
      throw new ServiceUnavailableException(`Fallo SSH al eliminar traffic table ${trafficId}: ${err.message}`);
    }

    await this.repo.remove(tt);
  }

  // ── Sincronización masiva desde OLT (UPSERT) ─────────────────
  async sincronizarDesdeOlt(
    oltId:     string,
    empresaId: string,
    tablas:    Array<{ index: number; name: string; cir_kbps?: number; pir_kbps?: number }>,
  ): Promise<{ insertadas: number; actualizadas: number }> {
    if (tablas.length === 0) return { insertadas: 0, actualizadas: 0 };

    const ids    = tablas.map(t => t.index);
    const names  = tablas.map(t => t.name);
    const cirs   = tablas.map(t => t.cir_kbps ?? null);
    const pirs   = tablas.map(t => t.pir_kbps ?? null);

    const [row] = await this.repo.manager.query<[{ insertadas: string; actualizadas: string }]>(
      `WITH upserted AS (
         INSERT INTO olt_traffic_tables
           (id, olt_id, empresa_id, traffic_id, nombre, cir_kbps, pir_kbps, origen, estado, created_at, updated_at)
         SELECT gen_random_uuid(), $1, $2,
                t.idx, t.name, t.cir, t.pir, 'olt', 'active', NOW(), NOW()
         FROM   unnest($3::int[], $4::text[], $5::int[], $6::int[])
                AS t(idx, name, cir, pir)
         ON CONFLICT (olt_id, traffic_id) DO UPDATE
           SET nombre     = EXCLUDED.nombre,
               cir_kbps   = EXCLUDED.cir_kbps,
               pir_kbps   = EXCLUDED.pir_kbps,
               updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert
       )
       SELECT
         COUNT(*) FILTER (WHERE is_insert)      AS insertadas,
         COUNT(*) FILTER (WHERE NOT is_insert)  AS actualizadas
       FROM upserted`,
      [oltId, empresaId, ids, names, cirs, pirs],
    );

    const insertadas   = Number(row.insertadas);
    const actualizadas = Number(row.actualizadas);
    this.logger.log(`Traffic table sync olt=${oltId}: ${insertadas} nuevas, ${actualizadas} actualizadas`);
    return { insertadas, actualizadas };
  }

  // ── Privados ──────────────────────────────────────────────────
  private async _assertNoOnusEnUso(oltId: string, trafficId: number): Promise<void> {
    const [{ count }] = await this.ds.query<[{ count: string }]>(
      `SELECT COUNT(*) AS count
       FROM ftth_onu_registro
       WHERE olt_id = $1 AND traffic_table_id = $2 AND deleted_at IS NULL`,
      [oltId, trafficId],
    );
    if (Number(count) > 0) {
      throw new ConflictException(
        `No se puede modificar traffic table ${trafficId}: ${count} ONU(s) activa(s) la están usando.`,
      );
    }
  }

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
