import {
  ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { OltServiceProfile } from '../entities/olt-service-profile.entity';
import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { OltConnService } from './olt-conn.service';
import { conSelloDatafast } from '../capability/olt-baseline-standard';

export class AgregarSrvProfileDto {
  // Modelo de la ONU (ej. EG8145V5) — el nombre final lleva sello: DATAFAST_EG8145V5
  @IsString() @MaxLength(24)                      modelo: string;
  @IsInt() @Min(1) @Max(24) @Type(() => Number)   eth:    number;
  @IsInt() @Min(0) @Max(8)  @Type(() => Number)   pots:   number = 0;
  @IsInt() @Min(0) @Max(4)  @Type(() => Number)   catv:   number = 0;
}

// ─────────────────────────────────────────────────────────────
// Tipos de ONU (ONT service-profiles) — excepción de la directriz de
// alcance: gestionables a demanda (en especial cuando el escaneo detecta
// un modelo nuevo durante la provisión). Sello DATAFAST obligatorio en
// los que crea el ERP; los preexistentes solo se observan.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltSrvProfileService {
  private readonly logger = new Logger(OltSrvProfileService.name);

  constructor(
    @InjectRepository(OltServiceProfile)
    private readonly repo: Repository<OltServiceProfile>,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectDataSource()
    private readonly ds: DataSource,

    private readonly automation:  OltAutomationClient,
    private readonly connService: OltConnService,
  ) {}

  // ── Crear tipo de ONU (atómico: CLI → BD) ─────────────────────
  async agregarConCli(
    oltId: string, empresaId: string, dto: AgregarSrvProfileDto,
  ): Promise<OltServiceProfile> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada.`);

    const nombre = conSelloDatafast(dto.modelo.trim().toUpperCase());

    const existente = await this.repo.findOne({ where: { oltId, nombre } });
    if (existente) {
      throw new ConflictException(`El tipo de ONU "${nombre}" ya existe en esta OLT (profile-id ${existente.profileId}).`);
    }

    const conn = await this.connService.buildConn(olt);
    const res  = await this.automation.srvProfileAdd({
      connection: conn, name: nombre, eth: dto.eth, pots: dto.pots, catv: dto.catv,
    });
    if (!res.success) {
      throw new UnprocessableEntityException(`CLI rechazó el tipo de ONU "${nombre}": ${res.error}`);
    }
    if (res.profile_id == null) {
      throw new ServiceUnavailableException(`La OLT creó "${nombre}" pero no retornó profile-id.`);
    }

    const perfil = await this.repo.save(this.repo.create({
      oltId, empresaId,
      profileId: res.profile_id,
      nombre:    res.name ?? nombre,
      origen:    'erp',
    }));
    this.logger.log(`Tipo de ONU creado | olt=${oltId} ${perfil.nombre} (profile-id ${perfil.profileId})`);
    return perfil;
  }

  // ── Eliminar tipo de ONU (guards: ownership + uso en el ERP + la OLT) ──
  async eliminarConCli(oltId: string, empresaId: string, profileId: number): Promise<void> {
    const perfil = await this.repo.findOne({ where: { oltId, empresaId, profileId } });
    if (!perfil) throw new NotFoundException(`Tipo de ONU ${profileId} no encontrado.`);

    if (perfil.origen !== 'erp') {
      throw new ConflictException(
        `El tipo de ONU "${perfil.nombre}" es preexistente en el equipo. El ERP no modifica recursos que no le pertenecen.`,
      );
    }

    // Guard ERP: ONUs aprovisionadas por el ERP usando este perfil.
    const [{ count }] = await this.ds.query<[{ count: string }]>(
      `SELECT COUNT(*) AS count FROM ftth_onu_registro
       WHERE olt_id = $1 AND srvprofile_id = $2 AND deleted_at IS NULL`,
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
    const res = await this.automation.srvProfileDelete({ connection: conn, name: perfil.nombre });
    if (!res.success) {
      throw new UnprocessableEntityException(`CLI rechazó la eliminación de "${perfil.nombre}": ${res.error}`);
    }

    await this.repo.remove(perfil);
    this.logger.log(`Tipo de ONU eliminado | olt=${oltId} ${perfil.nombre}`);
  }
}
