import {
  BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';
import {
  IsIn, IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { OltDispositivo }   from '../entities/olt-dispositivo.entity';
import { FtthOnuEstado, FtthOnuRegistro, ftthNecesitaRecovery } from '../entities/ftth-onu-registro.entity';
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
  @IsInt() @Min(0)           @Type(() => Number) lineprofileId: number;
  @IsInt() @Min(0)           @Type(() => Number) srvprofileId:  number;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) trafficIndexDown?: number;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) trafficIndexUp?:   number;
  @IsOptional() @IsString() @MaxLength(64)            description?:      string;
  // Modo WAN de la ONU:
  //  - 'bridge'  → ONU transparente; el PPPoE lo hace el router del cliente (BRAS).
  //                El OLT solo hace GPON + service-port. NO se inyecta WAN por OMCI.
  //  - 'routing' → la ONU corre PPPoE (WAN inyectada por OMCI en modo perfil).
  @IsOptional() @IsIn(['bridge', 'routing'])          wanMode?:          string;
}

export class ReinjectarWanDto {
  @IsUUID('4') contratoId: string;
}

export class CambiarVelocidadDto {
  @IsUUID('4') contratoId:       string;
  @IsInt() @Min(0) @Type(() => Number) trafficIndexDown: number;
  @IsInt() @Min(0) @Type(() => Number) trafficIndexUp:   number;
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

    // 1b. Guarda temprana de credenciales PPPoE: sin ellas NO se toca la OLT ni la
    // BD. Provisionar sin credenciales dejaría una ONU que nunca autenticaría contra
    // el BRAS. Se valida antes de allocar pools o insertar el lock.
    let pppoePass = contrato.password_pppoe;
    try { pppoePass = decrypt(pppoePass); } catch { /* si no está cifrado, usar tal cual */ }
    const pppoeUser = contrato.usuario_pppoe;
    if (!pppoeUser || !pppoePass) {
      throw new UnprocessableEntityException(
        'El contrato no tiene credenciales PPPoE. Active el servicio (crea el secret en ' +
        'el MikroTik) antes de aprovisionar la ONU.',
      );
    }

    // 2a. Purgar cualquier registro soft-deleted (desaprovisionado) del contrato.
    // `desaprovisionar` usa softDelete → deja la fila con deleted_at set. findOne la
    // ignora, pero la constraint unique(contrato_id) la sigue contando y haría chocar
    // el INSERT del re-aprovisionamiento ("otro proceso ya está aprovisionando").
    await this.ds.query(
      `DELETE FROM ftth_onu_registro WHERE contrato_id = $1 AND deleted_at IS NOT NULL`,
      [dto.contratoId],
    );

    // 2b. Validar registro existente vigente (re-intentable solo si fallido o inexistente)
    const registroExistente = await this.ftthRepo.findOne({
      where: { contratoId: dto.contratoId },
    });

    if (registroExistente) {
      // Una ONU aprovisionada exige desaprovisionar primero (protege el servicio activo).
      if (registroExistente.estado === FtthOnuEstado.ACTIVO || registroExistente.estado === FtthOnuEstado.SUSPENDIDO) {
        throw new ConflictException(
          `El contrato ya tiene una ONU FTTH ${registroExistente.estado} (SN: ${registroExistente.sn}). ` +
          `Para reaprovisionar primero desaprovisiónala.`,
        );
      }

      // Aprovisionamiento en curso con lock vigente (< umbral de recovery) → no pisar.
      const enCurso =
        registroExistente.estado === FtthOnuEstado.PENDIENTE ||
        registroExistente.estado === FtthOnuEstado.GPON_REGISTRADO ||
        registroExistente.estado === FtthOnuEstado.WAN_INYECTADO ||
        registroExistente.estado === FtthOnuEstado.DESAPROVISIONANDO;
      if (enCurso && !ftthNecesitaRecovery(registroExistente)) {
        throw new ConflictException(
          `Hay un aprovisionamiento en curso para este contrato ` +
          `(estado: ${registroExistente.estado}). Espera unos segundos o al recovery automático.`,
        );
      }

      // Re-aprovisionable: fallido, o en-curso con lock expirado (recovery). En ambos
      // casos se hace rollback GPON best-effort (por si dejó ONT/service-port en la OLT)
      // y se BORRA el registro — atómico: nada persiste, y el INSERT posterior no choca.
      this.logger.warn(
        `FTTH pre-retry: limpiando registro previo | contrato=${dto.contratoId} estado=${registroExistente.estado}`,
      );
      const oltPrevio = await this._fetchOlt(registroExistente.oltId, empresaId).catch(() => null);
      if (oltPrevio) {
        const pwPrevio   = this._decryptOltPassword(oltPrevio);
        const connPrevio = this._buildConn(oltPrevio, pwPrevio);
        await this.automation.ftthRollbackGpon({
          connection:      connPrevio,
          slot:            registroExistente.slot,
          port:            registroExistente.port,
          onu_id:          registroExistente.onuId,
          service_port_id: registroExistente.servicePortId,
        }).catch((err: any) => {
          this.logger.error(
            `FTTH pre-retry rollback falló (se procede de todos modos) | contrato=${dto.contratoId}: ${err.message}`,
          );
        });
      }
      await this.ftthRepo.delete(registroExistente.id);
    }

    // 3. Obtener OLT y construir conexión Python
    const olt      = await this._fetchOlt(oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    // 4. Resolver Service Port ID: pool automático o manual (bypass)
    const poolSvcPortId = await this.poolService.allocar(oltId, dto.contratoId);
    let   servicePortId = poolSvcPortId ?? dto.servicePortId;
    if (servicePortId == null) {
      throw new UnprocessableEntityException(
        `No hay pool de Service Port IDs configurado para esta OLT. ` +
        `Configúralo en el detalle de la OLT (pestaña Detalles → Pool de Service Port IDs) ` +
        `o ingresa el ID manualmente.`,
      );
    }
    const usedSvcPool = poolSvcPortId != null;

    // 4b. Sincronizar la ocupación REAL de ONT-IDs en la OLT (incluye ONUs de
    // SmartOLT/AdminOLT ausentes de nuestra BD). Así el pool asigna directo el primer
    // ID libre en vez de colisionar 1-por-1 con las ONUs existentes del puerto.
    const ontIdsEnOlt = await this.automation.ftthOntIds({
      connection: conn, slot: dto.slot, port: dto.port,
    });
    if (ontIdsEnOlt.length) {
      await this.onuIdPool.sincronizarOcupacionOlt(
        oltId, empresaId, dto.slot, dto.port, ontIdsEnOlt,
      );
    }

    // 5. Resolver ONU ID: pool automático (lazy init) o manual.
    // `let` porque el auto-sanado de colisión de ONT-ID puede reasignarlo (p.ej. si
    // el ID ya existe en la OLT por una ONU creada por SmartOLT, fuera de nuestra BD).
    let onuId = await this.onuIdPool.allocar(
      oltId, empresaId, dto.slot, dto.port, dto.contratoId,
    ).catch(async (err) => {
      // Si falla el pool de ONU IDs, liberar service port antes de propagar
      if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
      throw err;
    });

    // 6. Insertar lock atómico
    const wanMode = dto.wanMode === 'routing' ? 'routing' : 'bridge';
    const insertResult = await this.ds.query<{ id: string }[]>(
      `INSERT INTO ftth_onu_registro
         (id, empresa_id, contrato_id, olt_id, frame, slot, port, onu_id, sn,
          service_port_id, vlan, lineprofile_id, srvprofile_id,
          traffic_index_down, traffic_index_up, description, wan_mode,
          estado, locked_at, intentos_gpon, intentos_wan, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          'pendiente', NOW(), 0, 0, NOW(), NOW())
       ON CONFLICT (contrato_id) DO NOTHING
       RETURNING id`,
      [
        empresaId, dto.contratoId, oltId,
        dto.frame, dto.slot, dto.port, onuId, dto.sn.toUpperCase(),
        servicePortId, dto.vlan, dto.lineprofileId, dto.srvprofileId,
        dto.trafficIndexDown ?? null, dto.trafficIndexUp ?? null, dto.description ?? null, wanMode,
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

    // ── Fase 1: GPON (con auto-sanado de colisión de service-port) ──
    // Si el índice asignado por el pool ya existe en la OLT, se marca como
    // no-usable y se reintenta con el siguiente del pool (hasta 3 veces).
    let gponRes: { success: boolean; error?: string };
    for (let intento = 0; ; intento++) {
      this.logger.log(`FTTH Fase1 GPON | contrato=${dto.contratoId} sn=${dto.sn} onuId=${onuId} svcPort=${servicePortId} intento=${intento + 1}`);
      try {
        gponRes = await this.automation.ftthProvisionGpon({
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
      } catch (err: any) {
        // El cliente lanza en errores HTTP (422/503/timeout). Se trata como fallo
        // para no dejar el registro atascado en 'pendiente' con el lock puesto.
        gponRes = { success: false, error: err?.message ?? 'Error de comunicación con la OLT' };
      }
      if (gponRes.success) break;

      // Auto-sanado de colisión de service-port: reasignar del pool (hasta 3 veces).
      if (usedSvcPool && intento < 3 && this._esColisionServicePort(gponRes.error)) {
        await this.poolService.marcarColision(oltId, servicePortId!);
        const nuevo = await this.poolService.allocar(oltId, dto.contratoId);
        if (nuevo == null) break; // pool agotado → sale con el fallo actual
        servicePortId = nuevo;
        await this.ftthRepo.update(registroId, { servicePortId: nuevo });
        continue;
      }

      // Auto-sanado de colisión de ONT-ID: el ID ya existe en la OLT (típicamente una
      // ONU creada por SmartOLT/AdminOLT que no está en nuestra BD, por lo que el pool
      // la creía libre). Se marca ese ONU-ID como no-usable y se reasigna el siguiente.
      // El `ont add` falló → no hay ONT parcial, no hace falta rollback.
      if (intento < 5 && this._esColisionOntId(gponRes.error)) {
        await this.onuIdPool.marcarColision(oltId, dto.slot, dto.port, onuId);
        const nuevoOnu = await this.onuIdPool.allocar(
          oltId, empresaId, dto.slot, dto.port, dto.contratoId,
        ).catch(() => null);
        if (nuevoOnu == null) break; // puerto PON al máximo
        onuId = nuevoOnu;
        await this.ftthRepo.update(registroId, { onuId: nuevoOnu });
        this.logger.warn(
          `FTTH Fase1 colisión ONT-ID | contrato=${dto.contratoId} → reintento con onuId=${nuevoOnu}`,
        );
        continue;
      }

      // Lock transitorio de la OLT ("Currently operating conflicts with other user
      // operations"): otra sesión (health-poller / auto-save de la OLT) tiene el
      // config-lock. La ventana es breve → se limpia cualquier `ont add` parcial y se
      // reintenta con backoff. Como la Fase 1 revierte limpio, reintentar es seguro.
      if (intento < 3 && this._esLockTransitorio(gponRes.error)) {
        await this.automation.ftthRollbackGpon({
          connection: conn, slot: dto.slot, port: dto.port,
          onu_id: onuId, service_port_id: servicePortId,
        }).catch(() => { /* limpieza best-effort antes del reintento */ });
        const espera = 4000 + intento * 4000; // 4s, 8s, 12s
        this.logger.warn(
          `FTTH Fase1 lock transitorio | contrato=${dto.contratoId} intento=${intento + 1} → reintento en ${espera}ms`,
        );
        await new Promise(r => setTimeout(r, espera));
        continue;
      }

      break;
    }

    if (!gponRes.success) {
      // La Fase 1 puede fallar tras un `ont add` exitoso (p.ej. el service-port no
      // se creó/verificó). Rollback obligatorio para no dejar ONTs huérfanas en la
      // OLT que bloqueen el reintento con "The ONT ID has already existed".
      const rbOk = await this._rollbackGponWithLog(
        empresaId, registroId, dto.contratoId, oltId,
        olt, password, dto, servicePortId, onuId,
        'gpon_failed', FtthOnuEstado.PENDIENTE,
      );
      if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
      await this.onuIdPool.liberar(oltId, dto.contratoId);
      // Atómico: si no se concluye, no queda NADA en el sistema. Se borra el registro
      // (la ONU vuelve a autofind, la OLT quedó limpia por el rollback).
      await this.ftthRepo.delete(registroId);
      return {
        estado:     FtthOnuEstado.FALLIDO_GPON,
        registroId,
        mensaje:    `Fase 1 (GPON) falló y se revirtió todo (rollback ${rbOk ? 'OK' : 'FALLÓ'}). ` +
                    `${this._limpiar(gponRes.error) ?? ''}`.trim(),
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
      max_wait:   150,
    });

    if (!pollRes.success || pollRes.timeout) {
      const runState = this._limpiar(pollRes.run_state) ?? 'unknown';
      this.logger.warn(`FTTH poll timeout | contrato=${dto.contratoId} run_state=${runState} → rollback GPON`);
      const rbErr = pollRes.error ?? `Timeout de poll (150 s), último run-state: ${runState}`;
      const rbOk  = await this._rollbackGponWithLog(
        empresaId, registroId, dto.contratoId, oltId,
        olt, password, dto, servicePortId, onuId,
        'timeout_online', FtthOnuEstado.GPON_REGISTRADO,
      );
      if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
      await this.onuIdPool.liberar(oltId, dto.contratoId);
      // Atómico: rollback ya ejecutado, se borra el registro (no persiste nada).
      await this.ftthRepo.delete(registroId);
      return {
        estado:     FtthOnuEstado.TIMEOUT_ONLINE,
        registroId,
        mensaje:    `La ONU no apareció online en 150 s tras el registro GPON (estado: ${runState}). Rollback ejecutado, nada quedó registrado.`,
        error:      rbErr,
      };
    }

    // ── Modo BRIDGE: sin inyección WAN ────────────────────────
    // La ONU va transparente; el PPPoE lo hace el router del cliente contra el BRAS
    // MikroTik. El OLT ya tiene GPON + service-port → el aprovisionamiento concluye
    // EXITOSO aquí, sin tocar la WAN de la ONU.
    if (wanMode !== 'routing') {
      await this.ftthRepo.update(registroId, {
        estado:      FtthOnuEstado.ACTIVO,
        lockedAt:    null,
        ultimoError: null,
      });
      return {
        estado:  FtthOnuEstado.ACTIVO,
        registroId,
        mensaje: 'ONU aprovisionada (modo bridge). GPON + service-port OK. ' +
                 'El PPPoE lo maneja el router del cliente contra el BRAS.',
      };
    }

    // ── Fase 2: WAN PPPoE (modo routing) ──────────────────────
    // Credenciales PPPoE ya validadas en la guarda temprana (paso 1b).
    this.logger.log(`FTTH Fase2 WAN (routing) | contrato=${dto.contratoId}`);

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
      // GPON + service-port quedaron OK (verificados en Fase 1). La inyección WAN
      // vía OMCI falló — típicamente por incompatibilidad de la ONU (marcas no-Huawei
      // como ZTE F680). El aprovisionamiento se concluye EXITOSO (estado ACTIVO): la
      // ONU tiene ruta de datos. "WAN manual" NO es un estado: es solo un mensaje
      // informativo para el técnico instalador — la interfaz WAN/PPPoE se configura
      // manualmente en la ONU. La nota queda en ultimoError para que se vea en el panel.
      const notaWanManual =
        `WAN no inyectada (incompatibilidad de la ONU). Configúrela manualmente en la ` +
        `ONU — PPPoE usuario: ${pppoeUser} · clave: ${pppoePass}`;
      await this.ftthRepo.update(registroId, {
        estado:       FtthOnuEstado.ACTIVO,
        lockedAt:     null,
        intentosWan:  1,
        ultimoError:  this._limpiar(notaWanManual),
      });
      return {
        estado:     FtthOnuEstado.ACTIVO,
        registroId,
        mensaje:    `ONU aprovisionada (GPON + service-port OK). ${notaWanManual}`,
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
    // Usar registro.oltId, no el oltId de URL — la ONU está en la OLT donde fue aprovisionada
    const olt      = await this._fetchOlt(registro.oltId, empresaId);
    const password = this._decryptOltPassword(olt);
    const conn     = this._buildConn(olt, password);

    await this.ftthRepo.update(registro.id, { lockedAt: new Date() });

    let pppoePass = contrato.password_pppoe;
    try { pppoePass = decrypt(pppoePass); } catch { /* no cifrado */ }

    // Misma guarda de coherencia que provisionarFtth: sin credenciales PPPoE no
    // se inyecta la WAN (la ONU nunca autenticaría contra el BRAS MikroTik).
    if (!contrato.usuario_pppoe || !pppoePass) {
      await this.ftthRepo.update(registro.id, {
        estado:      FtthOnuEstado.FALLIDO_WAN,
        lockedAt:    null,
        ultimoError: 'Contrato sin credenciales PPPoE. Active el servicio en el MikroTik antes de reintentar la WAN.',
      });
      return {
        estado:     FtthOnuEstado.FALLIDO_WAN,
        registroId: registro.id,
        mensaje:    'El contrato no tiene credenciales PPPoE. Active el servicio en el MikroTik y reintente.',
        error:      'PPPOE_CREDENCIALES_AUSENTES',
      };
    }

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
        ultimoError: this._limpiar(wanRes.error) ?? 'Error re-inyección WAN',
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
  async obtenerEstado(contratoId: string, empresaId: string): Promise<FtthOnuRegistro | null> {
    return this.ftthRepo.findOne({ where: { contratoId, empresaId } });
  }

  // ────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────

  // Sanitiza texto proveniente del CLI de la OLT antes de persistirlo: la salida
  // SSH puede traer bytes nulos (0x00) y control que Postgres rechaza en UTF-8.
  private _limpiar(s?: string | null): string | null {
    if (s == null) return null;
    // eslint-disable-next-line no-control-regex
    const clean = s.replace(new RegExp(String.fromCharCode(0), "g"), "").trim();
    return clean.slice(0, 1000) || null;
  }

  // Detecta si el error de la OLT indica que el service-port ya existe (colisión),
  // para disparar el auto-sanado. Conservador: exige contexto de service-port.
  private _esColisionServicePort(error?: string): boolean {
    if (!error) return false;
    const e = error.toLowerCase();
    return /service.?port|service.?virtual.?port/.test(e)
        && /(exist|conflict|already|duplicad|been used|in use|repeat|existe|conflicto)/.test(e);
  }

  // Detecta la colisión de ONT-ID: el ID ya existe en la OLT (p.ej. ONU de SmartOLT
  // fuera de nuestra BD). Se auto-sana reasignando el siguiente ONU-ID libre.
  private _esColisionOntId(error?: string): boolean {
    if (!error) return false;
    const e = error.toLowerCase();
    return /ont.?id.*(already|exist)|has already existed|the ont id already/.test(e);
  }

  // Detecta el lock transitorio de la OLT (otra sesión tiene el config-lock).
  // Es reintentable con backoff — la ventana de bloqueo es breve.
  private _esLockTransitorio(error?: string): boolean {
    if (!error) return false;
    const e = error.toLowerCase();
    return /conflicts with other user|please retry later|currently operating|being used by another|try again later|operating conflicts/.test(e);
  }

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
  // ── Wrappers "por contrato" (ciclo de vida ONU↔contrato) ──────────
  // Resuelven la OLT desde el registro FTTH. Si el contrato no tiene ONU
  // (WISP, o ya desaprovisionado), OMITEN sin error → los usa outbox-red para
  // aplicar el ciclo de vida ONU de forma idempotente y resiliente, y el botón
  // Rollback de ContratoDetalle.
  async desaprovisionarPorContrato(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string; skipped?: boolean }> {
    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) {
      return { exitoso: true, skipped: true, mensaje: 'Contrato sin ONU FTTH — desaprovisionar omitido.' };
    }
    return this.desaprovisionar(registro.oltId, empresaId, { contratoId });
  }

  // ── cancelarFtth ──────────────────────────────────────────────────
  // Cierre/cancelación del wizard de aprovisionamiento: si el proceso NO concluyó,
  // se borra TODO (rollback en la OLT + liberar pools + borrar registro), dejando el
  // contrato como si nunca se hubiera iniciado. Una ONU ya ACTIVA/SUSPENDIDA no se
  // toca (esa se retira con Desaprovisionar). Idempotente.
  async cancelarFtth(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ cancelado: boolean; mensaje: string }> {
    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) {
      return { cancelado: false, mensaje: 'No hay aprovisionamiento por cancelar.' };
    }
    if (registro.estado === FtthOnuEstado.ACTIVO || registro.estado === FtthOnuEstado.SUSPENDIDO) {
      return {
        cancelado: false,
        mensaje: 'La ONU ya está aprovisionada; para retirarla usa Desaprovisionar.',
      };
    }

    // Rollback best-effort en la OLT (borra ont add + service-port si alcanzaron a crearse).
    const olt = await this._fetchOlt(registro.oltId, empresaId).catch(() => null);
    if (olt) {
      const conn = this._buildConn(olt, this._decryptOltPassword(olt));
      await this.automation.ftthRollbackGpon({
        connection:      conn,
        slot:            registro.slot,
        port:            registro.port,
        onu_id:          registro.onuId,
        service_port_id: registro.servicePortId,
      }).catch((err: any) => {
        this.logger.error(`FTTH cancelar rollback falló | contrato=${contratoId}: ${err.message}`);
      });
    }

    await this.poolService.liberar(registro.oltId, contratoId).catch(() => { /* best-effort */ });
    await this.onuIdPool.liberar(registro.oltId, contratoId).catch(() => { /* best-effort */ });
    await this.ftthRepo.delete(registro.id);

    this.logger.warn(`FTTH cancelado | contrato=${contratoId} estado_previo=${registro.estado}`);
    return { cancelado: true, mensaje: 'Aprovisionamiento cancelado — no quedó nada registrado.' };
  }

  async suspenderPorContrato(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string; skipped?: boolean }> {
    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) {
      return { exitoso: true, skipped: true, mensaje: 'Contrato sin ONU FTTH — suspender omitido.' };
    }
    return this.suspender(registro.oltId, empresaId, contratoId);
  }

  async rehabilitarPorContrato(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string; skipped?: boolean }> {
    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) {
      return { exitoso: true, skipped: true, mensaje: 'Contrato sin ONU FTTH — rehabilitar omitido.' };
    }
    return this.rehabilitar(registro.oltId, empresaId, contratoId);
  }

  async desaprovisionar(
    oltId:     string,
    empresaId: string,
    dto:       DesaprovisionarFtthDto,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {

    const registro = await this.ftthRepo.findOne({ where: { contratoId: dto.contratoId, empresaId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${dto.contratoId}.`);
    }
    if (registro.oltId !== oltId) {
      throw new BadRequestException('La OLT indicada no coincide con el registro de aprovisionamiento.');
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
        ultimoError: `Desaprovisionamiento falló: ${this._limpiar(rollbackError) ?? 'Error SSH'}`,
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

    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${contratoId}.`);
    }
    if (registro.oltId !== oltId) {
      throw new BadRequestException('La OLT indicada no coincide con el registro de aprovisionamiento.');
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

    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${contratoId}.`);
    }
    if (registro.oltId !== oltId) {
      throw new BadRequestException('La OLT indicada no coincide con el registro de aprovisionamiento.');
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

    const registro = await this.ftthRepo.findOne({ where: { contratoId: dto.contratoId, empresaId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${dto.contratoId}.`);
    }
    if (registro.oltId !== oltId) {
      throw new BadRequestException('La OLT indicada no coincide con el registro de aprovisionamiento.');
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
        connection:         conn,
        slot:               registro.slot,
        port:               registro.port,
        onu_id:             registro.onuId,
        service_port_id:    registro.servicePortId,
        traffic_index_down: dto.trafficIndexDown,
        traffic_index_up:   dto.trafficIndexUp,
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

    await this.ftthRepo.update(registro.id, {
      trafficIndexDown: dto.trafficIndexDown,
      trafficIndexUp:   dto.trafficIndexUp,
    });

    this.logger.log(
      `FTTH velocidad cambiada | contrato=${dto.contratoId} sn=${registro.sn} ` +
      `down=${dto.trafficIndexDown} up=${dto.trafficIndexUp}`,
    );
    return {
      exitoso: true,
      mensaje: `Velocidad actualizada. Down: ${dto.trafficIndexDown} / Up: ${dto.trafficIndexUp}.`,
    };
  }

  // ────────────────────────────────────────────────────────────
  // signalDashboard — batch-poll de señal para todas las ONUs activas de una OLT
  // ────────────────────────────────────────────────────────────
  async signalDashboard(
    oltId:     string,
    empresaId: string,
  ): Promise<Array<{
    registro:      FtthOnuRegistro;
    signal:        PythonOnuStatusInfo | null;
    clienteNombre: string | null;
    planNombre:    string | null;
  }>> {

    const registros = await this.ftthRepo.find({
      where: { oltId, empresaId, estado: FtthOnuEstado.ACTIVO },
      take:  500,
    });
    if (registros.length === 0) return [];

    // Obtener nombre de cliente y plan en una sola query para todos los contratos
    const contratoIds = registros.map(r => r.contratoId);
    const clienteRows = await this.ds.query<{
      contrato_id:    string;
      cliente_nombre: string;
      plan_nombre:    string | null;
    }[]>(
      `SELECT co.id AS contrato_id,
              cl.nombre_completo AS cliente_nombre,
              pl.nombre AS plan_nombre
       FROM contratos co
       JOIN clientes cl ON cl.id = co.cliente_id
       LEFT JOIN planes pl ON pl.id = co.plan_id
       WHERE co.id = ANY($1) AND co.deleted_at IS NULL`,
      [contratoIds],
    );
    const clienteMap = new Map(clienteRows.map(c => [c.contrato_id, c]));

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

    // Persistir runState + lastOnline en BD para cada ONU que respondió
    if (signalMap.size > 0) {
      const now = new Date();
      const updates = registros
        .map(r => ({ r, info: signalMap.get(`${r.slot}:${r.port}:${r.onuId}`) }))
        .filter((x): x is { r: FtthOnuRegistro; info: PythonOnuStatusInfo } => !!x.info);

      await Promise.all(updates.map(({ r, info }) =>
        this.ftthRepo.update(r.id, {
          runState:   info.run_state ?? null,
          lastOnline: info.run_state === 'online' ? now : r.lastOnline,
        }),
      ));
    }

    return registros.map(r => {
      const cliente = clienteMap.get(r.contratoId);
      return {
        registro:      r,
        signal:        signalMap.get(`${r.slot}:${r.port}:${r.onuId}`) ?? null,
        clienteNombre: cliente?.cliente_nombre ?? null,
        planNombre:    cliente?.plan_nombre    ?? null,
      };
    });
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
