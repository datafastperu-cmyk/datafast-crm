import {
  BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';
import {
  IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { OltDispositivo }   from '../entities/olt-dispositivo.entity';
import { FtthOnuEstado, FTTH_ESTADOS_FALLIDOS, FtthOnuRegistro, ftthNecesitaRecovery } from '../entities/ftth-onu-registro.entity';
import { FtthRollbackLog, RollbackMotivo } from '../entities/ftth-rollback-log.entity';
import { OltAutomationClient }            from '../olt-automation.client';
import { decrypt }                        from '../../../common/utils/encryption.util';
import { OltServicePortPoolService }      from './olt-service-port-pool.service';
import { OltOnuIdPoolService }           from './olt-onu-id-pool.service';
import { PythonOnuStatusInfo }           from '../dto/olt-nativo-ops.dto';

// ─────────────────────────────────────────────────────────────
// DTOs de entrada
// ─────────────────────────────────────────────────────────────
export class ProvisionarFtthDto {
  @IsUUID('4') contratoId: string;
  @IsInt() @Min(0) @Max(7)   @Type(() => Number) frame:         number;
  @IsInt() @Min(0) @Max(15)  @Type(() => Number) slot:          number;
  @IsInt() @Min(0) @Max(15)  @Type(() => Number) port:          number;
  @IsOptional() @IsInt() @Min(1) @Max(128) @Type(() => Number) onuId?:        number;
  @IsString() @MaxLength(16)                                    sn:            string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) servicePortId?: number;
  @IsInt() @Min(1) @Max(4094)@Type(() => Number) vlan:          number;
  @IsInt() @Min(1)           @Type(() => Number) lineprofileId: number;
  @IsInt() @Min(1)           @Type(() => Number) srvprofileId:  number;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) trafficIndexDown?: number;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) trafficIndexUp?:   number;
  @IsOptional() @IsString() @MaxLength(64)            description?:      string;
}

export class ReinjectarWanDto {
  @IsUUID('4') contratoId: string;
}

export class CambiarVelocidadDto {
  @IsUUID('4') contratoId:    string;
  @IsInt() @Min(0) @Type(() => Number) trafficIndex: number;
}

export class DesaprovisionarFtthDto {
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

    private readonly poolService: OltServicePortPoolService,

    private readonly onuIdPool: OltOnuIdPoolService,
  ) {}

  private async _logRollback(
    empresaId:   string,
    registroId:  string,
    contratoId:  string,
    oltId:       string,
    motivo:      RollbackMotivo,
    estadoPrevio: string,
    sshExitoso:  boolean,
    sshError?:   string,
  ): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO ftth_rollback_log
           (empresa_id, registro_id, contrato_id, olt_id, motivo, estado_previo, ssh_exitoso, ssh_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [empresaId, registroId, contratoId, oltId, motivo, estadoPrevio, sshExitoso, sshError ?? null],
      );
    } catch (e: any) {
      this.logger.warn(`rollback log insert failed: ${e.message}`);
    }
  }

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
      if (registroExistente.estado === FtthOnuEstado.ACTIVO || registroExistente.estado === FtthOnuEstado.SUSPENDIDO) {
        throw new ConflictException(
          `El contrato ya tiene una ONU FTTH ${registroExistente.estado} (SN: ${registroExistente.sn}). ` +
          `Para reaprovisionar primero desaprovisiónala.`,
        );
      }
      if (
        registroExistente.estado === FtthOnuEstado.PENDIENTE ||
        registroExistente.estado === FtthOnuEstado.GPON_REGISTRADO ||
        registroExistente.estado === FtthOnuEstado.WAN_INYECTADO ||
        registroExistente.estado === FtthOnuEstado.DESAPROVISIONANDO
      ) {
        if (!ftthNecesitaRecovery(registroExistente)) {
          throw new ConflictException(
            `Hay un aprovisionamiento en curso para este contrato ` +
            `(estado: ${registroExistente.estado}). Espera o espera al recovery automático.`,
          );
        }
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
      // Si fallido (cualquier tipo) → permitir reintento
      if (FTTH_ESTADOS_FALLIDOS.includes(registroExistente.estado)) {
        await this.ftthRepo.delete(registroExistente.id);
      }
    }

    // 3. Obtener OLT y construir conexión Python
    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    // 4. Resolver Service Port ID: pool automático o manual (bypass)
    const poolSvcPortId = await this.poolService.allocar(oltId, dto.contratoId);
    const servicePortId = poolSvcPortId ?? dto.servicePortId;
    if (servicePortId == null) {
      throw new UnprocessableEntityException(
        `No hay pool de Service Port IDs configurado para esta OLT. ` +
        `Configúralo desde la sección de OLT o ingresa el ID manualmente.`,
      );
    }
    const usedSvcPool = poolSvcPortId != null;

    // 5. Resolver ONU ID: pool automático (lazy init) o manual
    const onuId = await this.onuIdPool.allocar(
      oltId, empresaId, dto.slot, dto.port, dto.contratoId,
    ).catch(async (err) => {
      // Si falla el pool de ONU IDs, liberar service port antes de propagar
      if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
      throw err;
    });

    // 6. Insertar lock atómico
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
        dto.frame, dto.slot, dto.port, onuId, dto.sn.toUpperCase(),
        servicePortId, dto.vlan, dto.lineprofileId, dto.srvprofileId,
      ],
    );

    if (!insertResult.length) {
      // Otro proceso ganó la carrera — liberar ambos pools
      if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
      await this.onuIdPool.liberar(oltId, dto.contratoId);
      throw new ConflictException(
        `Otro proceso ya está aprovisionando este contrato. Intenta de nuevo en unos segundos.`,
      );
    }

    const registroId = insertResult[0].id;

    // ── Fase 1: GPON ──────────────────────────────────────────
    this.logger.log(`FTTH Fase1 GPON | contrato=${dto.contratoId} sn=${dto.sn} onuId=${onuId} svcPort=${servicePortId}`);
    const gponRes = await this.automation.ftthProvisionGpon({
      connection:      conn,
      frame:           dto.frame,
      slot:            dto.slot,
      port:            dto.port,
      onu_id:          onuId,
      sn:              dto.sn.toUpperCase(),
      service_port_id: servicePortId,
      vlan:            dto.vlan,
      lineprofile_id:  dto.lineprofileId,
      srvprofile_id:   dto.srvprofileId,
      traffic_index_down: dto.trafficIndexDown ?? null,
      traffic_index_up:   dto.trafficIndexUp   ?? null,
      description:        dto.description      ?? null,
    });

    if (!gponRes.success) {
      if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
      await this.onuIdPool.liberar(oltId, dto.contratoId);
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
    this.logger.log(`FTTH Fase1b poll | contrato=${dto.contratoId} onuId=${onuId}`);
    const pollRes = await this.automation.ftthPollOnline({
      connection: conn,
      slot:       dto.slot,
      port:       dto.port,
      onu_id:     onuId,
      max_wait:   90,
    });

    if (!pollRes.success || pollRes.timeout) {
      this.logger.warn(`FTTH poll timeout | contrato=${dto.contratoId} → rollback GPON`);
      const rbErr = pollRes.error ?? 'Timeout de poll (90 s)';
      const rbOk  = await this._rollbackGponWithLog(
        empresaId, registroId, dto.contratoId, oltId,
        olt, password, dto, servicePortId, onuId,
        'timeout_online', FtthOnuEstado.GPON_REGISTRADO,
      );
      if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
      await this.onuIdPool.liberar(oltId, dto.contratoId);
      await this.ftthRepo.update(registroId, {
        estado:      FtthOnuEstado.TIMEOUT_ONLINE,
        lockedAt:    null,
        ultimoError: `ONU no apareció online en 90 s. Rollback ${rbOk ? 'exitoso' : 'falló'}. ${rbErr}`,
      });
      return {
        estado:     FtthOnuEstado.TIMEOUT_ONLINE,
        registroId,
        mensaje:    'La ONU no apareció online en 90 s tras el registro GPON. Rollback ejecutado.',
        error:      rbErr,
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
      onu_id:     onuId,
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

    const registro = await this.ftthRepo.findOne({ where: { contratoId: dto.contratoId, empresaId } });
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

  private async _rollbackGponWithLog(
    empresaId:    string,
    registroId:   string,
    contratoId:   string,
    oltId:        string,
    olt:          OltDispositivo,
    password:     string,
    dto:          ProvisionarFtthDto,
    servicePortId: number,
    onuId:        number,
    motivo:       RollbackMotivo,
    estadoPrevio: FtthOnuEstado,
  ): Promise<boolean> {
    const conn = this._buildConn(olt, password);
    let sshOk = false;
    let sshErr: string | undefined;
    try {
      const res = await this.automation.ftthRollbackGpon({
        connection:      conn,
        slot:            dto.slot,
        port:            dto.port,
        onu_id:          onuId,
        service_port_id: servicePortId,
      });
      sshOk  = res.success;
      sshErr = res.error;
    } catch (err: any) {
      sshErr = err.message;
      this.logger.error(`FTTH rollback GPON falló | registroId=${registroId} err=${sshErr}`);
    }
    await this._logRollback(empresaId, registroId, contratoId, oltId, motivo, estadoPrevio, sshOk, sshErr);
    return sshOk;
  }

  // ────────────────────────────────────────────────────────────
  // desaprovisionar — eliminar ONU de la OLT y liberar recursos
  //
  // Permitido desde: activo, gpon_registrado, wan_inyectado
  // Flujo: marcar desaprovisionando → rollback GPON SSH →
  //        liberar pools (servicePort + onuId) → soft-delete registro
  // ────────────────────────────────────────────────────────────
  async desaprovisionar(
    oltId:     string,
    empresaId: string,
    dto:       DesaprovisionarFtthDto,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {

    const registro = await this.ftthRepo.findOne({ where: { contratoId: dto.contratoId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${dto.contratoId}.`);
    }

    const estadosPermitidos: FtthOnuEstado[] = [
      FtthOnuEstado.ACTIVO,
      FtthOnuEstado.GPON_REGISTRADO,
      FtthOnuEstado.WAN_INYECTADO,
    ];
    if (!estadosPermitidos.includes(registro.estado)) {
      throw new BadRequestException(
        `No se puede desaprovisionar desde el estado "${registro.estado}". ` +
        `Solo se permite desde: ${estadosPermitidos.join(', ')}.`,
      );
    }

    // Marcar como en proceso (lock)
    await this.ftthRepo.update(registro.id, {
      estado:   FtthOnuEstado.DESAPROVISIONANDO,
      lockedAt: new Date(),
    });

    const olt = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    // Ejecutar rollback GPON en la OLT
    let rollbackOk = false;
    let rollbackError: string | undefined;
    try {
      const res = await this.automation.ftthRollbackGpon({
        connection:      conn,
        slot:            registro.slot,
        port:            registro.port,
        onu_id:          registro.onuId,
        service_port_id: registro.servicePortId,
      });
      rollbackOk    = res.success;
      rollbackError = res.error;
    } catch (err: any) {
      rollbackError = err.message;
      this.logger.error(
        `FTTH desaprovisionar SSH falló | contrato=${dto.contratoId} error=${err.message}`,
      );
    }

    await this._logRollback(
      empresaId, registro.id, dto.contratoId, oltId,
      'manual_desaprovisionar', registro.estado,
      rollbackOk, rollbackError,
    );

    if (!rollbackOk) {
      await this.ftthRepo.update(registro.id, {
        estado:      registro.estado,
        lockedAt:    null,
        ultimoError: `Desaprovisionamiento falló: ${rollbackError ?? 'Error SSH'}`,
      });
      return {
        exitoso: false,
        mensaje: 'No se pudo eliminar la ONU de la OLT vía SSH. Verifica la conectividad.',
        error:   rollbackError,
      };
    }

    await Promise.all([
      this.poolService.liberar(oltId, dto.contratoId),
      this.onuIdPool.liberar(oltId, dto.contratoId),
    ]);

    await this.ftthRepo.softDelete(registro.id);

    this.logger.log(
      `FTTH desaprovisionado | contrato=${dto.contratoId} sn=${registro.sn} olt=${olt.ipGestion}`,
    );
    return {
      exitoso: true,
      mensaje: `ONU ${registro.sn} desaprovisionada correctamente. Recursos liberados.`,
    };
  }

  // ────────────────────────────────────────────────────────────
  // suspender — desactiva ONT en OLT sin eliminar service-port
  // ────────────────────────────────────────────────────────────
  async suspender(
    oltId:     string,
    empresaId: string,
    contratoId: string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {

    const registro = await this.ftthRepo.findOne({ where: { contratoId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${contratoId}.`);
    }
    if (registro.estado !== FtthOnuEstado.ACTIVO) {
      throw new BadRequestException(
        `Solo se puede suspender desde el estado "activo". Estado actual: "${registro.estado}".`,
      );
    }
    if (registro.servicePortId == null) {
      throw new BadRequestException('El registro FTTH no tiene service-port asignado.');
    }

    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    let exitoso = false;
    let error: string | undefined;
    try {
      const res = await this.automation.ftthSuspendOnu({
        connection:      conn,
        slot:            registro.slot,
        port:            registro.port,
        onu_id:          registro.onuId,
        service_port_id: registro.servicePortId,
      });
      exitoso = res.success;
      error   = res.error;
    } catch (err: any) {
      error = err.message;
      this.logger.error(`FTTH suspender SSH falló | contrato=${contratoId} error=${err.message}`);
    }

    if (!exitoso) {
      return { exitoso: false, mensaje: 'No se pudo suspender la ONU en la OLT.', error };
    }

    await this.ftthRepo.update(registro.id, { estado: FtthOnuEstado.SUSPENDIDO });
    this.logger.log(`FTTH suspendido | contrato=${contratoId} sn=${registro.sn}`);
    return { exitoso: true, mensaje: `ONU ${registro.sn} suspendida correctamente.` };
  }

  // ────────────────────────────────────────────────────────────
  // rehabilitar — reactiva ONT previamente suspendida
  // ────────────────────────────────────────────────────────────
  async rehabilitar(
    oltId:     string,
    empresaId: string,
    contratoId: string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {

    const registro = await this.ftthRepo.findOne({ where: { contratoId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${contratoId}.`);
    }
    if (registro.estado !== FtthOnuEstado.SUSPENDIDO) {
      throw new BadRequestException(
        `Solo se puede rehabilitar desde el estado "suspendido". Estado actual: "${registro.estado}".`,
      );
    }
    if (registro.servicePortId == null) {
      throw new BadRequestException('El registro FTTH no tiene service-port asignado.');
    }

    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    let exitoso = false;
    let error: string | undefined;
    try {
      const res = await this.automation.ftthRehabilitateOnu({
        connection:      conn,
        slot:            registro.slot,
        port:            registro.port,
        onu_id:          registro.onuId,
        service_port_id: registro.servicePortId,
      });
      exitoso = res.success;
      error   = res.error;
    } catch (err: any) {
      error = err.message;
      this.logger.error(`FTTH rehabilitar SSH falló | contrato=${contratoId} error=${err.message}`);
    }

    if (!exitoso) {
      return { exitoso: false, mensaje: 'No se pudo rehabilitar la ONU en la OLT.', error };
    }

    await this.ftthRepo.update(registro.id, { estado: FtthOnuEstado.ACTIVO });
    this.logger.log(`FTTH rehabilitado | contrato=${contratoId} sn=${registro.sn}`);
    return { exitoso: true, mensaje: `ONU ${registro.sn} rehabilitada correctamente.` };
  }

  // ────────────────────────────────────────────────────────────
  // cambiarVelocidad — actualiza traffic-table del service-port en caliente
  // ────────────────────────────────────────────────────────────
  async cambiarVelocidad(
    oltId:     string,
    empresaId: string,
    dto:       CambiarVelocidadDto,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {

    const registro = await this.ftthRepo.findOne({ where: { contratoId: dto.contratoId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${dto.contratoId}.`);
    }
    if (registro.estado !== FtthOnuEstado.ACTIVO && registro.estado !== FtthOnuEstado.SUSPENDIDO) {
      throw new BadRequestException(
        `Solo se puede cambiar la velocidad desde los estados "activo" o "suspendido". ` +
        `Estado actual: "${registro.estado}".`,
      );
    }
    if (registro.servicePortId == null) {
      throw new BadRequestException('El registro FTTH no tiene service-port asignado.');
    }

    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    let exitoso = false;
    let error: string | undefined;
    try {
      const res = await this.automation.ftthChangeLineprofile({
        connection:      conn,
        slot:            registro.slot,
        port:            registro.port,
        onu_id:          registro.onuId,
        service_port_id: registro.servicePortId,
        traffic_index:   dto.trafficIndex,
      });
      exitoso = res.success;
      error   = res.error;
    } catch (err: any) {
      error = err.message;
      this.logger.error(`FTTH cambiarVelocidad SSH falló | contrato=${dto.contratoId} error=${err.message}`);
    }

    if (!exitoso) {
      return { exitoso: false, mensaje: 'No se pudo cambiar la velocidad en la OLT.', error };
    }

    this.logger.log(
      `FTTH velocidad cambiada | contrato=${dto.contratoId} sn=${registro.sn} traffic_index=${dto.trafficIndex}`,
    );
    return {
      exitoso: true,
      mensaje: `Velocidad actualizada correctamente. Traffic-table: ${dto.trafficIndex}.`,
    };
  }

  // ────────────────────────────────────────────────────────────
  // signalDashboard — batch-poll de señal para todas las ONUs activas de una OLT
  // ────────────────────────────────────────────────────────────
  async signalDashboard(
    oltId:     string,
    empresaId: string,
  ): Promise<Array<{ registro: FtthOnuRegistro; signal: PythonOnuStatusInfo | null }>> {

    const registros = await this.ftthRepo.find({
      where: { oltId, empresaId, estado: FtthOnuEstado.ACTIVO },
      take:  500,
    });
    if (registros.length === 0) return [];

    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    const signalMap = new Map<string, PythonOnuStatusInfo>();
    try {
      const batch = await this.automation.batchStatus({
        connection: conn,
        onus: registros.map(r => ({ slot: r.slot, port: r.port, onu_id: r.onuId, sn: r.sn })),
      });
      for (const info of batch.onus) {
        signalMap.set(`${info.slot}:${info.port}:${info.onu_id}`, info);
      }
    } catch (err: any) {
      this.logger.warn(`signalDashboard batch-status falló | olt=${oltId}: ${err.message}`);
    }

    return registros.map(r => ({
      registro: r,
      signal:   signalMap.get(`${r.slot}:${r.port}:${r.onuId}`) ?? null,
    }));
  }

  // ────────────────────────────────────────────────────────────
  // reconciliar — compara ONUs en OLT real vs registros ERP
  // ────────────────────────────────────────────────────────────
  async reconciliar(
    oltId:     string,
    empresaId: string,
  ): Promise<{
    enErpNoEnOlt:  FtthOnuRegistro[];
    enOltNoEnErp:  Array<{ sn: string; slot: number; port: number; ont_model?: string }>;
    sincronizados: number;
  }> {

    const registros = await this.ftthRepo.find({
      where: { oltId, empresaId, estado: FtthOnuEstado.ACTIVO },
    });

    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    // ── enErpNoEnOlt: batchStatus sobre registros ERP activos ──────
    // batchStatus consulta ONUs CONFIGURADAS en la OLT (no autofind).
    // Si una ONU activa en ERP no responde señal → puede estar offline
    // o eliminada de la OLT.
    const enErpNoEnOlt: FtthOnuRegistro[] = [];
    if (registros.length > 0) {
      try {
        const batch = await this.automation.batchStatus({
          connection: conn,
          onus: registros.map(r => ({ slot: r.slot, port: r.port, onu_id: r.onuId, sn: r.sn })),
        });
        const presenteEnOlt = new Set(
          batch.onus
            .filter(o => o.run_state !== null)
            .map(o => `${o.slot}:${o.port}:${o.onu_id}`),
        );
        for (const r of registros) {
          if (!presenteEnOlt.has(`${r.slot}:${r.port}:${r.onuId}`)) {
            enErpNoEnOlt.push(r);
          }
        }
      } catch (err: any) {
        this.logger.warn(`reconciliar batchStatus falló | olt=${oltId}: ${err.message}`);
      }
    }

    // ── enOltNoEnErp: discover ONUs no autorizadas en la OLT ───────
    // ONUs detectadas por autofind = registradas físicamente pero sin
    // configuración en la OLT → pendientes de provisioning en el ERP.
    let enOltNoEnErp: Array<{ sn: string; slot: number; port: number; ont_model?: string }> = [];
    const erpSnSet = new Set(registros.map(r => r.sn.toUpperCase()));
    try {
      const discovered = await this.automation.discoverOnus({ connection: conn, slot: null, port: null });
      enOltNoEnErp = (discovered.onus ?? []).filter(o => !erpSnSet.has(o.sn.toUpperCase()));
    } catch (err: any) {
      this.logger.warn(`reconciliar discoverOnus falló | olt=${oltId}: ${err.message}`);
    }

    const sincronizados = registros.length - enErpNoEnOlt.length;

    this.logger.log(
      `reconciliar | olt=${oltId} ERP=${registros.length} ` +
      `enErpNoEnOlt=${enErpNoEnOlt.length} enOltNoErp=${enOltNoEnErp.length}`,
    );

    return { enErpNoEnOlt, enOltNoEnErp, sincronizados };
  }

  async listarPorOlt(
    oltId: string, empresaId: string, take: number, skip: number,
  ): Promise<{ data: FtthOnuRegistro[]; total: number }> {
    const [data, total] = await this.ftthRepo.findAndCount({
      where: { oltId, empresaId },
      order: { createdAt: 'DESC' },
      take,
      skip,
    });
    return { data, total };
  }
}
