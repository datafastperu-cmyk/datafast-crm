import {
  BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';
import {
  IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { OltDispositivo }   from '../entities/olt-dispositivo.entity';
import { FtthOnuEstado, FtthOnuRegistro } from '../entities/ftth-onu-registro.entity';
import { OltAutomationClient }            from '../olt-automation.client';
import { decrypt }                        from '../../../common/utils/encryption.util';

// ─────────────────────────────────────────────────────────────
// DTOs de entrada
// ─────────────────────────────────────────────────────────────
export class ProvisionarFtthDto {
  @IsUUID('4') contratoId: string;
  @IsInt() @Min(0) @Max(7)   @Type(() => Number) frame:         number;
  @IsInt() @Min(0) @Max(15)  @Type(() => Number) slot:          number;
  @IsInt() @Min(0) @Max(15)  @Type(() => Number) port:          number;
  @IsInt() @Min(1) @Max(128) @Type(() => Number) onuId:         number;
  @IsString() @MaxLength(16)                     sn:            string;
  @IsInt() @Min(1)           @Type(() => Number) servicePortId: number;
  @IsInt() @Min(1) @Max(4094)@Type(() => Number) vlan:          number;
  @IsInt() @Min(1)           @Type(() => Number) lineprofileId: number;
  @IsInt() @Min(1)           @Type(() => Number) srvprofileId:  number;
  @IsOptional() @IsString() @MaxLength(64)        description?:  string;
}

export class ReinjectarWanDto {
  @IsUUID('4') contratoId: string;
}

// ─────────────────────────────────────────────────────────────
// Resultado público
// ─────────────────────────────────────────────────────────────
export interface FtthProvisionResult {
  estado:   FtthOnuEstado;
  registroId: string;
  mensaje:  string;
  error?:   string;
}

// ─────────────────────────────────────────────────────────────
// ProvisionFtthService
//
// Orquesta el aprovisionamiento FTTH bifásico:
//   Fase 1  → GPON: ont add + service-port en la OLT
//   Fase 1b → poll: esperar que la ONU aparezca online
//   Fase 2  → WAN: inyectar config PPPoE vía OMCI
//
// Atómica gracias al UNIQUE en ftth_onu_registro(contrato_id):
// INSERT ON CONFLICT sirve como mutex distribuido ligero.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class ProvisionFtthService {
  private readonly logger = new Logger(ProvisionFtthService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(FtthOnuRegistro)
    private readonly ftthRepo: Repository<FtthOnuRegistro>,

    private readonly automation: OltAutomationClient,
  ) {}

  // ────────────────────────────────────────────────────────────
  // provisionarFtth — flujo completo (lock → GPON → poll → WAN)
  // ────────────────────────────────────────────────────────────
  async provisionarFtth(
    oltId:     string,
    empresaId: string,
    dto:       ProvisionarFtthDto,
  ): Promise<FtthProvisionResult> {

    // 1. Validar contrato
    const contrato = await this._fetchContrato(dto.contratoId, empresaId);

    // 2. Validar registro existente (re-intentable solo si fallido o inexistente)
    const registroExistente = await this.ftthRepo.findOne({
      where: { contratoId: dto.contratoId },
    });

    if (registroExistente) {
      if (registroExistente.estado === FtthOnuEstado.ACTIVO) {
        throw new ConflictException(
          `El contrato ya tiene una ONU FTTH activa (SN: ${registroExistente.sn}). ` +
          `Para reaprovisionar primero ejecuta el rollback.`,
        );
      }
      if (
        registroExistente.estado === FtthOnuEstado.PENDIENTE ||
        registroExistente.estado === FtthOnuEstado.GPON_REGISTRADO ||
        registroExistente.estado === FtthOnuEstado.WAN_INYECTADO ||
        registroExistente.estado === FtthOnuEstado.DESAPROVISIONANDO
      ) {
        if (!registroExistente.necesitaRecovery) {
          throw new ConflictException(
            `Hay un aprovisionamiento en curso para este contrato ` +
            `(estado: ${registroExistente.estado}). Espera o espera al recovery automático.`,
          );
        }
        // lockedAt > 10 min → recovery: marcar fallido y proceder
        this.logger.warn(
          `FTTH recovery: registro bloqueado > 10 min, forzando a fallido_gpon | ` +
          `contrato=${dto.contratoId} estado=${registroExistente.estado}`,
        );
        await this.ftthRepo.update(registroExistente.id, {
          estado:    FtthOnuEstado.FALLIDO_GPON,
          lockedAt:  null,
          ultimoError: 'Recovery automático por lock expirado (> 10 min)',
        });
      }
      // Si fallido → permitir reintento: borrar el registro para volver a crear
      if (
        registroExistente.estado === FtthOnuEstado.FALLIDO_GPON ||
        registroExistente.estado === FtthOnuEstado.FALLIDO_WAN
      ) {
        await this.ftthRepo.delete(registroExistente.id);
      }
    }

    // 3. Obtener OLT y construir conexión Python
    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    // 4. Insertar lock atómico
    const insertResult = await this.ds.query<{ id: string }[]>(
      `INSERT INTO ftth_onu_registro
         (id, empresa_id, contrato_id, olt_id, frame, slot, port, onu_id, sn,
          service_port_id, vlan, lineprofile_id, srvprofile_id, estado, locked_at,
          intentos_gpon, intentos_wan, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, 'pendiente', NOW(),
          0, 0, NOW(), NOW())
       ON CONFLICT (contrato_id) DO NOTHING
       RETURNING id`,
      [
        empresaId, dto.contratoId, oltId,
        dto.frame, dto.slot, dto.port, dto.onuId, dto.sn.toUpperCase(),
        dto.servicePortId, dto.vlan, dto.lineprofileId, dto.srvprofileId,
      ],
    );

    if (!insertResult.length) {
      throw new ConflictException(
        `Otro proceso ya está aprovisionando este contrato. ` +
        `Intenta de nuevo en unos segundos.`,
      );
    }

    const registroId = insertResult[0].id;

    // ── Fase 1: GPON ──────────────────────────────────────────
    this.logger.log(`FTTH Fase1 GPON | contrato=${dto.contratoId} sn=${dto.sn} onu_id=${dto.onuId}`);
    const gponRes = await this.automation.ftthProvisionGpon({
      connection:      conn,
      frame:           dto.frame,
      slot:            dto.slot,
      port:            dto.port,
      onu_id:          dto.onuId,
      sn:              dto.sn.toUpperCase(),
      service_port_id: dto.servicePortId,
      vlan:            dto.vlan,
      lineprofile_id:  dto.lineprofileId,
      srvprofile_id:   dto.srvprofileId,
      description:     dto.description ?? null,
    });

    if (!gponRes.success) {
      await this.ftthRepo.update(registroId, {
        estado:        FtthOnuEstado.FALLIDO_GPON,
        lockedAt:      null,
        intentosGpon:  1,
        ultimoError:   gponRes.error ?? 'Error desconocido en Fase 1 GPON',
      });
      return {
        estado:     FtthOnuEstado.FALLIDO_GPON,
        registroId,
        mensaje:    'Fase 1 (GPON) falló. La ONU no fue registrada en la OLT.',
        error:      gponRes.error,
      };
    }

    await this.ftthRepo.update(registroId, {
      estado:       FtthOnuEstado.GPON_REGISTRADO,
      intentosGpon: 1,
    });

    // ── Fase 1b: Poll online ──────────────────────────────────
    this.logger.log(`FTTH Fase1b poll | contrato=${dto.contratoId} onu_id=${dto.onuId}`);
    const pollRes = await this.automation.ftthPollOnline({
      connection: conn,
      slot:       dto.slot,
      port:       dto.port,
      onu_id:     dto.onuId,
      max_wait:   90,
    });

    if (!pollRes.success || pollRes.timeout) {
      // ONU registrada pero nunca online — hacer rollback GPON
      this.logger.warn(`FTTH poll timeout | contrato=${dto.contratoId} → rollback GPON`);
      await this._rollbackGpon(registroId, olt, password, dto);
      return {
        estado:     FtthOnuEstado.FALLIDO_GPON,
        registroId,
        mensaje:    'La ONU no apareció online en 90 s tras el registro GPON. Rollback ejecutado.',
        error:      pollRes.error ?? 'Timeout de poll',
      };
    }

    // ── Fase 2: WAN PPPoE ─────────────────────────────────────
    this.logger.log(`FTTH Fase2 WAN | contrato=${dto.contratoId}`);
    const pppoeUser = contrato.usuario_pppoe;
    let   pppoePass = contrato.password_pppoe;
    try { pppoePass = decrypt(pppoePass); } catch { /* si no está cifrado, usar tal cual */ }

    const wanRes = await this.automation.ftthInjectWanPppoe({
      connection: conn,
      slot:       dto.slot,
      port:       dto.port,
      onu_id:     dto.onuId,
      vlan:       dto.vlan,
      username:   pppoeUser,
      password:   pppoePass,
    });

    if (!wanRes.success) {
      await this.ftthRepo.update(registroId, {
        estado:       FtthOnuEstado.FALLIDO_WAN,
        lockedAt:     null,
        intentosWan:  1,
        ultimoError:  wanRes.error ?? 'Error desconocido en Fase 2 WAN',
      });
      return {
        estado:     FtthOnuEstado.FALLIDO_WAN,
        registroId,
        mensaje:    'GPON OK pero la inyección WAN PPPoE falló. Puedes reintentar con reinjectarWan.',
        error:      wanRes.error,
      };
    }

    // ── Éxito total ───────────────────────────────────────────
    await this.ftthRepo.update(registroId, {
      estado:       FtthOnuEstado.ACTIVO,
      lockedAt:     null,
      intentosWan:  1,
      ultimoError:  null,
    });

    return {
      estado:     FtthOnuEstado.ACTIVO,
      registroId,
      mensaje:    `ONU aprovisionada correctamente. GPON registrada y WAN PPPoE inyectada.`,
    };
  }

  // ────────────────────────────────────────────────────────────
  // reinjectarWan — reintentar solo la Fase 2 (GPON ya hecho)
  // ────────────────────────────────────────────────────────────
  async reinjectarWan(
    oltId:     string,
    empresaId: string,
    dto:       ReinjectarWanDto,
  ): Promise<FtthProvisionResult> {

    const registro = await this.ftthRepo.findOne({ where: { contratoId: dto.contratoId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${dto.contratoId}.`);
    }
    if (registro.estado !== FtthOnuEstado.FALLIDO_WAN && registro.estado !== FtthOnuEstado.GPON_REGISTRADO) {
      throw new BadRequestException(
        `El estado actual es "${registro.estado}". Solo se puede re-inyectar WAN desde "fallido_wan" o "gpon_registrado".`,
      );
    }

    const contrato = await this._fetchContrato(dto.contratoId, empresaId);
    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    await this.ftthRepo.update(registro.id, { lockedAt: new Date() });

    let pppoePass = contrato.password_pppoe;
    try { pppoePass = decrypt(pppoePass); } catch { /* no cifrado */ }

    const wanRes = await this.automation.ftthInjectWanPppoe({
      connection: conn,
      slot:       registro.slot,
      port:       registro.port,
      onu_id:     registro.onuId,
      vlan:       registro.vlan,
      username:   contrato.usuario_pppoe,
      password:   pppoePass,
    });

    if (!wanRes.success) {
      await this.ftthRepo.update(registro.id, {
        estado:      FtthOnuEstado.FALLIDO_WAN,
        lockedAt:    null,
        intentosWan: registro.intentosWan + 1,
        ultimoError: wanRes.error ?? 'Error re-inyección WAN',
      });
      return {
        estado:     FtthOnuEstado.FALLIDO_WAN,
        registroId: registro.id,
        mensaje:    'Re-inyección WAN fallida.',
        error:      wanRes.error,
      };
    }

    await this.ftthRepo.update(registro.id, {
      estado:      FtthOnuEstado.ACTIVO,
      lockedAt:    null,
      intentosWan: registro.intentosWan + 1,
      ultimoError: null,
    });

    return {
      estado:     FtthOnuEstado.ACTIVO,
      registroId: registro.id,
      mensaje:    'WAN PPPoE re-inyectada correctamente.',
    };
  }

  // ────────────────────────────────────────────────────────────
  // obtenerEstado — consultar el registro FTTH de un contrato
  // ────────────────────────────────────────────────────────────
  async obtenerEstado(contratoId: string): Promise<FtthOnuRegistro | null> {
    return this.ftthRepo.findOne({ where: { contratoId } });
  }

  // ────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────

  private async _fetchContrato(contratoId: string, empresaId: string) {
    const rows = await this.ds.query<{
      estado: string;
      tipo_servicio: string;
      usuario_pppoe: string;
      password_pppoe: string;
    }[]>(
      `SELECT estado, tipo_servicio, usuario_pppoe, password_pppoe
       FROM contratos
       WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [contratoId, empresaId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Contrato ${contratoId} no encontrado.`);
    }
    const c = rows[0];
    if (c.tipo_servicio !== 'ftth') {
      throw new BadRequestException(
        `Este contrato es de tipo "${c.tipo_servicio}". El aprovisionamiento FTTH solo aplica a contratos de tipo FTTH.`,
      );
    }
    if (c.estado !== 'activo') {
      throw new BadRequestException(
        `El contrato debe estar ACTIVO para aprovisionar (estado actual: "${c.estado}").`,
      );
    }
    if (!c.usuario_pppoe) {
      throw new BadRequestException(
        `El contrato no tiene usuario PPPoE configurado. Configúralo antes de aprovisionar.`,
      );
    }
    return c;
  }

  private async _fetchOlt(oltId: string, empresaId: string): Promise<OltDispositivo> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId, activo: true } });
    if (!olt) {
      throw new NotFoundException(`OLT ${oltId} no encontrada o no pertenece a esta empresa.`);
    }
    return olt;
  }

  private _decryptOltPassword(olt: OltDispositivo): string {
    try {
      return decrypt(olt.contrasenaCifrada);
    } catch {
      throw new ServiceUnavailableException(
        `No se pudo descifrar la contraseña de la OLT "${olt.nombre}".`,
      );
    }
  }

  private _buildConn(olt: OltDispositivo, password: string) {
    return {
      ip:       olt.ipGestion,
      port:     olt.puerto,
      username: olt.usuarioAnclado,
      password,
      brand:    olt.marca,
    };
  }

  private async _rollbackGpon(
    registroId: string,
    olt: OltDispositivo,
    password: string,
    dto: ProvisionarFtthDto,
  ): Promise<void> {
    const conn = this._buildConn(olt, password);
    try {
      await this.automation.ftthRollbackGpon({
        connection:      conn,
        slot:            dto.slot,
        port:            dto.port,
        onu_id:          dto.onuId,
        service_port_id: dto.servicePortId,
      });
    } catch (err: any) {
      this.logger.error(
        `FTTH rollback GPON falló | registroId=${registroId} error=${err.message}`,
      );
    }
    await this.ftthRepo.update(registroId, {
      estado:      FtthOnuEstado.FALLIDO_GPON,
      lockedAt:    null,
      ultimoError: 'ONU no apareció online — rollback GPON ejecutado',
    });
  }
}
