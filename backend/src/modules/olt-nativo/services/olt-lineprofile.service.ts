import {
  ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { OltLineProfile } from '../entities/olt-line-profile.entity';
import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { OltConnService } from './olt-conn.service';
import { conSelloDatafast } from '../capability/olt-baseline-standard';

export class AgregarLineProfileDto {
  // Nombre base (ej. LINE) — el nombre final lleva sello: DATAFAST_LINE
  @IsString() @MaxLength(20)                              nombre: string;
  // Ancho de banda máximo del DBA type4 (best-effort) en Mbps.
  @IsInt() @Min(10) @Max(10000) @Type(() => Number)       dbaMaxMbps: number;
}

// ─────────────────────────────────────────────────────────────
// Line-profiles GPON — excepción de la directriz de alcance junto a los
// tipos de ONU y traffic tables. El ERP crea su perfil canónico
// (mapping-mode priority 802.1p + tr069-management enable + DBA propio
// type4 best-effort) con sello DATAFAST; los preexistentes solo se observan.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltLineProfileService {
  private readonly logger = new Logger(OltLineProfileService.name);

  constructor(
    @InjectRepository(OltLineProfile)
    private readonly repo: Repository<OltLineProfile>,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectDataSource()
    private readonly ds: DataSource,

    private readonly automation:  OltAutomationClient,
    private readonly connService: OltConnService,
  ) {}

  // ── Crear line-profile canónico (atómico: CLI → BD) ──────────
  async agregarConCli(
    oltId: string, empresaId: string, dto: AgregarLineProfileDto,
  ): Promise<OltLineProfile> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada.`);

    const nombre    = conSelloDatafast(dto.nombre.trim().toUpperCase());
    const dbaNombre = `${nombre}-DBA`;

    const existente = await this.repo.findOne({ where: { oltId, nombre } });
    if (existente) {
      throw new ConflictException(
        `El line-profile "${nombre}" ya existe en esta OLT (profile-id ${existente.profileId}).`,
      );
    }

    const conn = await this.connService.buildConn(olt);
    const res  = await this.automation.lineProfileAdd({
      connection: conn, name: nombre, dba_name: dbaNombre,
      dba_max_kbps: dto.dbaMaxMbps * 1024,
    });
    if (!res.success) {
      throw new UnprocessableEntityException(`CLI rechazó el line-profile "${nombre}": ${res.error}`);
    }
    if (res.profile_id == null) {
      throw new ServiceUnavailableException(`La OLT creó "${nombre}" pero no retornó profile-id.`);
    }

    const perfil = await this.repo.save(this.repo.create({
      oltId, empresaId,
      profileId:    res.profile_id,
      nombre:       res.name ?? nombre,
      origen:       'erp',
      dbaProfileId: res.dba_profile_id,
      dbaNombre:    res.dba_name ?? dbaNombre,
    }));
    this.logger.log(
      `Line-profile creado | olt=${oltId} ${perfil.nombre} (profile-id ${perfil.profileId}, dba ${perfil.dbaProfileId})`,
    );
    return perfil;
  }

  // ── Eliminar line-profile (guards: ownership + uso en el ERP + la OLT) ──
  async eliminarConCli(oltId: string, empresaId: string, profileId: number): Promise<void> {
    const perfil = await this.repo.findOne({ where: { oltId, empresaId, profileId } });
    if (!perfil) throw new NotFoundException(`Line-profile ${profileId} no encontrado.`);

    if (perfil.origen !== 'erp') {
      throw new ConflictException(
        `El line-profile "${perfil.nombre}" es preexistente en el equipo. El ERP no modifica recursos que no le pertenecen.`,
      );
    }

    // Guard ERP: ONUs aprovisionadas por el ERP usando este perfil.
    const [{ count }] = await this.ds.query<[{ count: string }]>(
      `SELECT COUNT(*) AS count FROM ftth_onu_registro
       WHERE olt_id = $1 AND lineprofile_id = $2 AND deleted_at IS NULL`,
      [oltId, profileId],
    );
    if (Number(count) > 0) {
      throw new ConflictException(
        `No se puede eliminar "${perfil.nombre}": ${count} ONU(s) del ERP lo usan.`,
      );
    }

    const olt  = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    const conn = await this.connService.buildConn(olt!);
    // La OLT además rechaza el undo si el perfil tiene bindings de cualquier
    // sistema (Binding times > 0) — ese error se propaga tal cual.
    const res = await this.automation.lineProfileDelete({
      connection: conn, name: perfil.nombre, dba_name: perfil.dbaNombre,
    });
    if (!res.success) {
      throw new UnprocessableEntityException(`CLI rechazó la eliminación de "${perfil.nombre}": ${res.error}`);
    }
    if (perfil.dbaNombre && res.dba_eliminado === false) {
      this.logger.warn(
        `Line-profile "${perfil.nombre}" eliminado pero su DBA "${perfil.dbaNombre}" sigue en la OLT (¿referenciado por otro perfil?).`,
      );
    }

    await this.repo.remove(perfil);
    this.logger.log(`Line-profile eliminado | olt=${oltId} ${perfil.nombre}`);
  }
}
