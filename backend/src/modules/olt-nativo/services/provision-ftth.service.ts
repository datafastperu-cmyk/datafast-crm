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
import { OltMgmtIpPoolService }          from './olt-mgmt-ip-pool.service';
import { PythonOnuStatusInfo, PythonFtthWanPppoeRequest } from '../dto/olt-nativo-ops.dto';
import { conSelloDatafast } from '../capability/olt-baseline-standard';
import { ProvisioningStrategyResolver } from './cpe-provisioning/provisioning-strategy-resolver.service';
import { Tr069GenieacsClient } from '../../tr069/tr069-genieacs.client';

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

// Carril de bootstrap TR-069 (ZTP): añade el plano de gestión (mgmt WAN DHCP + service-port
// GEM2 + FEC) a una ONU ya aprovisionada, para que reciba la ACS URL por DHCP Option 43 y
// aparezca sola en GenieACS. Requiere el DHCP server + Option 43 en la VLAN de gestión (MikroTik).
export class BootstrapTr069Dto {
  @IsUUID('4') contratoId: string;
  // Opcional: si se omite, se toma del perfil TR-069 de la OLT (tr069_mgmt_vlan) o su VLAN por defecto.
  @IsOptional() @IsInt() @Min(1) @Max(4094) @Type(() => Number) mgmtVlan?: number;
  // Opcional: si se omite, se asigna del pool de gestión (canal 'gestion') de la OLT.
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) mgmtServicePortId?: number;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) trafficIndex?:  number;
  @IsOptional() @IsInt() @Min(0) @Max(7) @Type(() => Number) priority?: number;
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

    private readonly mgmtIpPool: OltMgmtIpPoolService,

    private readonly cpeResolver: ProvisioningStrategyResolver,

    private readonly genieacs: Tr069GenieacsClient,
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

    // 1b. Guarda temprana: en modo ROUTING se validan los datos del método de auth del
    // contrato (pppoe→credenciales, amarre_ip_mac→IP+máscara, dhcp→nada) ANTES de tocar
    // la OLT/BD. En bridge no se inyecta WAN → no aplica (el PPPoE lo hace el router).
    if (dto.wanMode === 'routing') {
      const chk = this._buildWanInject(contrato, {
        slot: dto.slot, port: dto.port, onuId: dto.onuId ?? 1, vlan: dto.vlan,
      });
      if (chk.error) throw new UnprocessableEntityException(chk.error);
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
      // Una ONU SUSPENDIDA debe rehabilitarse antes de re-aprovisionar (no bypassear el
      // corte). Una ONU ACTIVA SÍ se puede re-aprovisionar ("Re-Aprovisionar" del modal):
      // se hace rollback + provisión fresca con los datos actuales + inyección WAN.
      if (registroExistente.estado === FtthOnuEstado.SUSPENDIDO) {
        throw new ConflictException(
          `La ONU está SUSPENDIDA (SN: ${registroExistente.sn}). Rehabilítala antes de re-aprovisionar.`,
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
          connection:           connPrevio,
          slot:                 registroExistente.slot,
          port:                 registroExistente.port,
          onu_id:               registroExistente.onuId,
          service_port_id:      registroExistente.servicePortId,
          mgmt_service_port_id: registroExistente.mgmtServicePortId,
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
          // Sello DataFast: toda ONT aprovisionada por el ERP queda marcada en
          // la OLT como propia (visible en display ont info / desc).
          description:        conSelloDatafast(dto.description ?? contrato.numero_contrato ?? ''),
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

    // ── Carril de gestión TR-069 (ZTP) — INTRÍNSECO al aprovisionamiento ──
    // Causa raíz de "los botones de la ONU no funcionan": al (re)aprovisionar, la OLT
    // recrea SOLO el plano de datos; sin el carril de gestión la ONU no aparece en
    // GenieACS y toda operación TR-069 (WiFi, reboot, detalle) queda inalcanzable. Se
    // asegura aquí, en el ÚNICO punto común (tras ONU online), para TODAS las ONUs de una
    // OLT con TR-069 activo y en CUALQUIER ruta (botón Aprovisionar, reaplicar, recovery).
    // Idempotente (reusa el service-port de gestión del contrato) y best-effort (no tumba
    // el aprovisionamiento del plano de datos si el carril falla).
    const carrilNota = await this._ensureCarrilGestion(
      olt, conn, registroId, dto.contratoId, dto.slot, dto.port, onuId,
    );

    // Punto único común tras confirmar el service-port de datos en la OLT — ver
    // _syncVlanContrato para la causa raíz que esto corrige (contratos.vlan_id NULL).
    await this._syncVlanContrato(dto.contratoId, empresaId, dto.vlan);

    // ── Modo BRIDGE: sin inyección WAN ────────────────────────
    // La ONU va transparente; el PPPoE lo hace el router del cliente contra el BRAS
    // MikroTik. El OLT ya tiene GPON + service-port → el aprovisionamiento concluye
    // EXITOSO aquí, sin tocar la WAN de la ONU.
    if (wanMode !== 'routing') {
      await this.ftthRepo.update(registroId, {
        estado:      FtthOnuEstado.ACTIVO,
        lockedAt:    null,
      });
      return {
        estado:  FtthOnuEstado.ACTIVO,
        registroId,
        mensaje: 'ONU aprovisionada (modo bridge). GPON + service-port OK. ' +
                 'El PPPoE lo maneja el router del cliente contra el BRAS.' + carrilNota,
      };
    }

    // ── Fase 2: WAN (modo routing) según el método de auth del contrato ──
    // pppoe → PPPoE · amarre_ip_mac → static · amarre_ip_mac_dhcp → dhcp.
    this.logger.log(`FTTH Fase2 WAN (routing) | contrato=${dto.contratoId} auth=${contrato.tipo_auth ?? 'pppoe'}`);
    const wanInject = this._buildWanInject(contrato, { slot: dto.slot, port: dto.port, onuId, vlan: dto.vlan });
    if (wanInject.error) {
      await this.ftthRepo.update(registroId, {
        estado: FtthOnuEstado.ACTIVO, lockedAt: null, intentosWan: 1,
        ultimoError: this._limpiar(wanInject.error),
      });
      return {
        estado: FtthOnuEstado.ACTIVO, registroId,
        mensaje: `ONU aprovisionada (GPON + service-port OK). WAN pendiente: ${wanInject.error}` + carrilNota,
      };
    }

    const wanRes = await this.automation.ftthInjectWanPppoe({ connection: conn, ...wanInject.payload! });

    if (!wanRes.success) {
      // GPON + service-port OK (verificados). La inyección WAN falló (incompatibilidad
      // de la ONU o enlace). El aprovisionamiento concluye EXITOSO (ACTIVO); la WAN se
      // configura manualmente. La nota queda en ultimoError para verla en el panel.
      const notaWanManual =
        `WAN (${wanInject.payload!.mode}) no inyectada — configúrela manualmente en la ONU. ` +
        `${this._limpiar(wanRes.error) ?? ''}`.trim();
      await this.ftthRepo.update(registroId, {
        estado:       FtthOnuEstado.ACTIVO,
        lockedAt:     null,
        intentosWan:  1,
        ultimoError:  this._limpiar(notaWanManual),
      });
      return {
        estado:     FtthOnuEstado.ACTIVO,
        registroId,
        mensaje:    `ONU aprovisionada (GPON + service-port OK). ${notaWanManual}` + carrilNota,
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
      mensaje:    `ONU aprovisionada correctamente. GPON registrada y WAN PPPoE inyectada.` + carrilNota,
    };
  }

  // ────────────────────────────────────────────────────────────
  // _ensureCarrilGestion — asegura el carril de gestión TR-069 (ZTP)
  //
  // Punto ÚNICO de aplicación del carril de gestión, invocado desde provisionarFtth
  // (ruta común de todo (re)aprovisionamiento). Idempotente: reusa el service-port de
  // gestión ya asignado al contrato en el pool (sobrevive al re-aprovisionamiento), y el
  // lado Python valida ownership del service-port ("already exists" → no-op si es el mismo
  // F/S/P+ONT+VLAN). Best-effort: nunca lanza — el plano de datos ya está OK.
  // Persiste el estado del carril para trazabilidad y para la red de seguridad (reconcile).
  // ────────────────────────────────────────────────────────────
  private async _ensureCarrilGestion(
    olt:        OltDispositivo,
    conn:       any,
    registroId: string,
    contratoId: string,
    slot:       number,
    port:       number,
    onuId:      number,
  ): Promise<string> {
    if (!olt.tr069Enabled) return '';

    // Directriz "inyectar desde cero": la VLAN de gestión debe ser la CANÓNICA que declara
    // el baseline (olt.tr069MgmtVlan lo puebla el plan vía declarar_tr069_vlan), NUNCA
    // vlanGestionDefecto — ese campo puede reflejar una VLAN heredada/no-canónica de la OLT.
    const mgmtVlan = olt.tr069MgmtVlan ?? null;
    if (mgmtVlan == null) {
      this.logger.warn(`carril: OLT ${olt.id} con TR-069 activo pero SIN VLAN TR-069 canónica declarada — carril omitido`);
      return ' Carril TR-069 omitido: la OLT no tiene VLAN TR-069 canónica declarada (asigna y aplica el Baseline Datafast Estándar).';
    }

    // Reusa el service-port de gestión del contrato si ya lo tenía; si no, asigna del pool.
    let mgmtSvcPort: number | null;
    try {
      mgmtSvcPort = await this.poolService.allocar(olt.id, contratoId, 'gestion');
    } catch (err: any) {
      this.logger.error(`carril: pool de gestión agotado | olt=${olt.id}: ${err?.message}`);
      return ' Carril TR-069 pendiente: pool de gestión agotado (amplía el rango del canal "gestion").';
    }
    if (mgmtSvcPort == null) {
      this.logger.warn(`carril: OLT ${olt.id} sin pool de gestión configurado — carril omitido`);
      return ' Carril TR-069 omitido: configura el pool del canal "gestion" en la OLT.';
    }

    // Carril de gestión ESTÁTICO (causa raíz 2026-07-17, CNT-2026-000004): DHCP en el
    // IP-host de gestión nunca materializó tráfico (2 ONUs, 2 firmwares, confirmado con
    // sniffer). Ingeniería inversa contra una ONU aprovisionada por SmartOLT confirmó que
    // el mecanismo real es IP ESTÁTICA + `ont tr069-server-config` — replicado aquí sobre
    // la VLAN de gestión propia del ERP (nunca la infraestructura de SmartOLT).
    if (!olt.tr069AcsUrl || !olt.tr069MgmtGateway) {
      this.logger.warn(`carril: OLT ${olt.id} sin acsUrl/mgmtGateway configurados — carril omitido`);
      await this.poolService.liberar(olt.id, contratoId, 'gestion');
      return ' Carril TR-069 omitido: configura la URL del ACS y el gateway de gestión en el perfil TR-069 de la OLT.';
    }
    let mgmtIp: string | null;
    try {
      mgmtIp = await this.mgmtIpPool.allocar(olt.id, contratoId);
    } catch (err: any) {
      this.logger.error(`carril: pool de IPs de gestión agotado | olt=${olt.id}: ${err?.message}`);
      await this.poolService.liberar(olt.id, contratoId, 'gestion');
      return ' Carril TR-069 pendiente: pool de IPs de gestión agotado (amplía el rango en la OLT).';
    }
    if (mgmtIp == null) {
      this.logger.warn(`carril: OLT ${olt.id} sin pool de IPs de gestión configurado — carril omitido`);
      await this.poolService.liberar(olt.id, contratoId, 'gestion');
      return ' Carril TR-069 omitido: configura el pool de IPs de gestión en la OLT.';
    }

    // Carril canónico del ERP (directriz "inyectar desde cero"): usar la
    // traffic table ERP-MGMT del baseline estándar, nunca el index 0
    // preexistente de la OLT. Fallback a 0 SOLO si el estándar aún no se
    // aplicó en esta OLT (queda advertido en logs y visible en compliance).
    const trafficIndex = await this._resolverTrafficIndexGestion(olt.id);
    const priority     = 2;
    let res: { success: boolean; error?: string };
    try {
      res = await this.automation.ftthBootstrapTr069({
        connection:           conn,
        slot, port, onu_id:   onuId,
        mgmt_vlan:            mgmtVlan,
        mgmt_service_port_id: mgmtSvcPort,
        mgmt_ip:              mgmtIp,
        mgmt_mask:            olt.tr069MgmtMask || '255.255.255.0',
        mgmt_gateway:         olt.tr069MgmtGateway,
        acs_url:              olt.tr069AcsUrl,
        traffic_index:        trafficIndex,
        priority,
      });
    } catch (err: any) {
      res = { success: false, error: err?.message ?? 'error de comunicación con la OLT' };
    }

    if (!res.success) {
      this.logger.error(`carril: bootstrap TR-069 falló | contrato=${contratoId} olt=${olt.id}: ${res.error}`);
      await this.ftthRepo.update(registroId, { ultimoError: this._limpiar(res.error) });
      return ` Carril TR-069 NO aplicado: ${this._limpiar(res.error) ?? 'error'} (la ONU no aparecerá en GenieACS).`;
    }

    await this.ftthRepo.update(registroId, {
      tr069BootstrapAplicado: true,
      mgmtServicePortId:      mgmtSvcPort,
      mgmtVlan,
      mgmtTrafficIndex:       trafficIndex,
      mgmtPriority:           priority,
    });

    // Verificación de plano de gestión (Inc. post-incidente 2026-07-17, CNT-2026-000004):
    // que la OLT haya aceptado el comando OMCI NO significa que el firmware de la ONU
    // materializó el IP-host en tráfico real — en esa ONU la config quedó "aceptada"
    // durante días mientras el canal de gestión estaba completamente muerto (0 tramas
    // Ethernet emitidas, confirmado con sniffer). Se sondea brevemente (no bloquea el
    // aprovisionamiento si tarda — la ONU puede seguir negociando DHCP después) y se
    // distingue "aplicado y confirmado" de "aceptado por OMCI, sin confirmar" en el
    // mensaje devuelto al operador.
    let confirmado = false;
    for (let intento = 0; intento < 4; intento++) {
      await new Promise((r) => setTimeout(r, 3000));
      const chk = await this.automation.ftthCheckMgmtIp({ connection: conn, slot, port, onu_id: onuId });
      if (chk.has_ip) { confirmado = true; break; }
    }

    this.logger.log(
      `carril TR-069 ${confirmado ? 'OK confirmado' : 'aceptado SIN confirmar'} | ` +
      `contrato=${contratoId} olt=${olt.id} mgmtVlan=${mgmtVlan} svcPort=${mgmtSvcPort}`,
    );
    return confirmado
      ? ' Carril TR-069 aplicado y confirmado (IP de gestión obtenida — la ONU aparecerá en GenieACS).'
      : ' Carril TR-069 aceptado por la OLT, pero SIN confirmar (la ONU no obtuvo IP de gestión tras ' +
        '12s — puede tardar más o ser una limitación de firmware de esta unidad; revisa el panel TR-069 luego).';
  }

  // Resuelve el índice de la traffic table de gestión canónica (ERP-MGMT,
  // creada por el Baseline Datafast Estándar). Fallback: 0 con advertencia.
  private async _resolverTrafficIndexGestion(oltId: string): Promise<number> {
    try {
      const [row] = await this.ds.query<{ traffic_id: number }[]>(
        `SELECT traffic_id FROM olt_traffic_tables
         WHERE olt_id = $1 AND nombre IN ('DATAFAST-MGMT', 'ERP-MGMT') AND origen = 'erp'
         ORDER BY (nombre = 'DATAFAST-MGMT') DESC
         LIMIT 1`,
        [oltId],
      );
      if (row) return row.traffic_id;
    } catch (e) {
      this.logger.warn(`_resolverTrafficIndexGestion | olt=${oltId}: ${(e as Error).message}`);
    }
    this.logger.warn(
      `carril: OLT ${oltId} sin traffic table ERP-MGMT — usando index 0 preexistente. ` +
      `Aplica el Baseline Datafast Estándar para corregirlo.`,
    );
    return 0;
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
    // Retro-completa contratos.vlan_id para registros creados antes de este fix.
    await this._syncVlanContrato(dto.contratoId, empresaId, registro.vlan);

    return {
      estado:     FtthOnuEstado.ACTIVO,
      registroId: registro.id,
      mensaje:    'WAN PPPoE re-inyectada correctamente.',
    };
  }

  // ────────────────────────────────────────────────────────────
  // bootstrapTr069 — carril ZTP: mgmt WAN DHCP + service-port GEM2 + FEC
  //
  // Añade el plano de gestión a una ONU ya aprovisionada (activo/gpon_registrado).
  // La ONU hace DHCP en la VLAN de gestión y recibe la ACS URL vía DHCP Option 43
  // (servida por el MikroTik gateway de esa VLAN) → aparece sola en GenieACS.
  // NO usa ont wan-config (rompería el IP host de gestión — verificado en EG8145V5).
  // ────────────────────────────────────────────────────────────
  async bootstrapTr069(
    oltId:     string,
    empresaId: string,
    dto:       BootstrapTr069Dto,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {

    const registro = await this.ftthRepo.findOne({ where: { contratoId: dto.contratoId, empresaId } });
    if (!registro) {
      throw new NotFoundException(`No hay registro FTTH para el contrato ${dto.contratoId}.`);
    }
    if (registro.oltId !== oltId) {
      throw new BadRequestException('La OLT indicada no coincide con el registro de aprovisionamiento.');
    }
    if (registro.estado !== FtthOnuEstado.ACTIVO && registro.estado !== FtthOnuEstado.GPON_REGISTRADO) {
      throw new BadRequestException(
        `El carril TR-069 solo se aplica a ONUs "activo" o "gpon_registrado". Estado actual: "${registro.estado}".`,
      );
    }

    const olt  = await this._fetchOlt(oltId, empresaId);
    const conn = this._buildConn(olt, this._decryptOltPassword(olt));

    // VLAN de gestión: la del DTO o, por defecto, la del perfil TR-069 de la OLT
    // (equivalente al "TR069 Profile" de SmartOLT) o la VLAN de gestión por defecto.
    const mgmtVlan = dto.mgmtVlan ?? olt.tr069MgmtVlan ?? olt.vlanGestionDefecto ?? undefined;
    if (mgmtVlan == null) {
      throw new UnprocessableEntityException(
        'No hay VLAN de gestión: configúrala en el perfil TR-069 de la OLT o pásala en la petición.',
      );
    }

    // Asignación del service-port de GESTIÓN desde el pool (canal 'gestion').
    // Si el pool no está configurado (allocar → null) se exige el ID manual en el DTO.
    const asignadoDelPool = dto.mgmtServicePortId == null;
    let   mgmtServicePortId = dto.mgmtServicePortId ?? null;
    if (asignadoDelPool) {
      mgmtServicePortId = await this.poolService.allocar(oltId, dto.contratoId, 'gestion');
      if (mgmtServicePortId == null) {
        throw new UnprocessableEntityException(
          'No hay pool de gestión configurado para esta OLT y no se indicó mgmtServicePortId. ' +
          'Configura el rango del canal "gestion" o envía el ID manualmente.',
        );
      }
    }

    // Carril ESTÁTICO (causa raíz 2026-07-17): requiere acsUrl/mgmtGateway del perfil
    // TR-069 de la OLT y una IP del pool de gestión — ver _ensureCarrilGestion.
    if (!olt.tr069AcsUrl || !olt.tr069MgmtGateway) {
      throw new UnprocessableEntityException(
        'Configura la URL del ACS y el gateway de gestión en el perfil TR-069 de la OLT antes de aplicar el carril.',
      );
    }
    const mgmtIp = await this.mgmtIpPool.allocar(oltId, dto.contratoId);
    if (mgmtIp == null) {
      throw new UnprocessableEntityException(
        'No hay pool de IPs de gestión configurado para esta OLT. Configúralo antes de aplicar el carril.',
      );
    }

    // Carril canónico: ERP-MGMT del baseline estándar; el DTO puede forzar otro.
    const mgmtTrafficIndex = dto.trafficIndex ?? await this._resolverTrafficIndexGestion(oltId);

    this.logger.log(
      `FTTH bootstrapTr069 | contrato=${dto.contratoId} onu=${registro.slot}/${registro.port}/${registro.onuId} ` +
      `mgmtVlan=${mgmtVlan} svcPort=${mgmtServicePortId}${asignadoDelPool ? ' (pool gestion)' : ''} ` +
      `mgmtIp=${mgmtIp} ttIndex=${mgmtTrafficIndex}`,
    );

    // DISP: la decisión de "por qué canal" (OMCI, HTTP-CPE, u otro futuro) NO
    // se resuelve aquí — se delega al ProvisioningStrategyResolver, que consulta
    // el catálogo de capacidad del dispositivo y verifica convergencia real
    // contra GenieACS antes de reportar éxito (VIO: aceptado ≠ confirmado).
    const resolverResult = await this.cpeResolver.ejecutarBootstrap({
      device: {
        fabricante: olt.marca,
        modelo:     registro.equipmentId ?? 'DESCONOCIDO',
        firmware:   registro.firmwareVersion ?? null,
        sn:         registro.sn,
        mgmtIp,
      },
      acsUrl:          olt.tr069AcsUrl,
      acsUsername:     olt.tr069AcsUsername ?? 'tr069',
      acsPassword:     olt.tr069AcsPassword ? decrypt(olt.tr069AcsPassword) : '',
      connReqUsername: olt.tr069ConnReqUsername ?? undefined,
      connReqPassword: olt.tr069ConnReqPassword ? decrypt(olt.tr069ConnReqPassword) : undefined,
      oltId,
      empresaId,
      ftthRegistroId:  registro.id,
      omci: {
        connection:           conn,
        slot:                 registro.slot,
        port:                 registro.port,
        onuId:                registro.onuId,
        mgmtVlan,
        mgmtServicePortId:    mgmtServicePortId!,
        mgmtMask:             olt.tr069MgmtMask || '255.255.255.0',
        mgmtGateway:          olt.tr069MgmtGateway,
        trafficIndex:         mgmtTrafficIndex,
        priority:             dto.priority ?? 2,
      },
    });

    if (!resolverResult.exitoso) {
      // Devolver el service-port de gestión al pool si lo tomamos nosotros (rollback).
      if (asignadoDelPool) {
        await this.poolService.liberar(oltId, dto.contratoId, 'gestion').catch(() => { /* best-effort */ });
      }
      await this.ftthRepo.update(registro.id, { ultimoError: this._limpiar(resolverResult.mensaje) });
      return {
        exitoso: false,
        mensaje: resolverResult.mensaje,
        error:   resolverResult.intentos.map((i) => `${i.canal}: ${i.mensaje}`).join(' | '),
      };
    }

    // Persistir el estado del carril para poder RESTAURARLO tras un re-aprovisionamiento
    // (la OLT borra los service-ports de la ONU al re-registrarla). Se guarda el mismo
    // mgmtServicePortId (ya asignado a este contrato en el pool) para reutilizarlo idéntico.
    await this.ftthRepo.update(registro.id, {
      ultimoError:            null,
      tr069BootstrapAplicado: true,
      mgmtServicePortId,
      mgmtVlan,
      mgmtTrafficIndex,
      mgmtPriority:           dto.priority ?? 2,
    });
    this.logger.log(
      `FTTH bootstrapTr069 OK | contrato=${dto.contratoId} mgmtVlan=${mgmtVlan} canal=${resolverResult.canalUsado}`,
    );
    return {
      exitoso: true,
      mensaje: resolverResult.mensaje,
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

  // Sincroniza contratos.vlan_id con la VLAN real del service-port de datos en la OLT.
  // Causa raíz (2026-07-17): el flujo nativo de aprovisionamiento (este archivo) nunca
  // escribía este campo — solo lo hacía el orquestador LEGACY de SmartOLT
  // (smartolt/orquestador-ftth.service.ts). Con el flujo nativo como único camino de
  // aprovisionamiento, contratos.vlan_id quedaba NULL para el 100% de las ONUs nuevas,
  // dejando inerte el guard de drift de actualizarWan() (`contrato.vlan_id !== registro.vlan`)
  // que evita reinyectar la WAN con una VLAN desactualizada. Se llama en el ÚNICO punto
  // común tras confirmar el service-port en la OLT (ver provisionarFtth), para TODAS las
  // rutas (bridge, routing OK, routing con WAN pendiente). Best-effort: un fallo aquí no
  // debe tumbar un aprovisionamiento ya exitoso en la OLT.
  private async _syncVlanContrato(contratoId: string, empresaId: string, vlan: number): Promise<void> {
    try {
      await this.ds.query(
        `UPDATE contratos SET vlan_id = $1 WHERE id = $2 AND empresa_id = $3 AND deleted_at IS NULL`,
        [vlan, contratoId, empresaId],
      );
    } catch (e) {
      this.logger.warn(
        `_syncVlanContrato falló (no bloqueante) | contrato=${contratoId} vlan=${vlan}: ${(e as Error).message}`,
      );
    }
  }

  private async _fetchContrato(contratoId: string, empresaId: string) {
    const rows = await this.ds.query<{
      estado:          string;
      tipo_servicio:   string;
      tipo_auth:       string | null;
      vlan_id:         number | null;
      numero_contrato: string | null;
      usuario_pppoe:   string | null;
      password_pppoe:  string | null;
      ip_asignada:     string | null;
      mask:            string | null;
      gateway:         string | null;
      dns_primario:    string | null;
    }[]>(
      `SELECT c.estado, c.tipo_servicio, c.tipo_auth, c.vlan_id, c.numero_contrato,
              c.usuario_pppoe, c.password_pppoe,
              host(c.ip_asignada)       AS ip_asignada,
              host(netmask(s.red_cidr)) AS mask,
              host(s.gateway)           AS gateway,
              host(s.dns_primario)      AS dns_primario
       FROM   contratos c
       LEFT JOIN segmentos_ipv4 s ON s.id = c.segmento_id
       WHERE  c.id = $1 AND c.empresa_id = $2 AND c.deleted_at IS NULL`,
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
    // La validación de credenciales/IP depende del método de auth → _buildWanInject.
    return c;
  }

  // Construye el payload de inyección WAN según el método de autenticación del contrato.
  // Retorna { error } si faltan datos requeridos para ese método.
  private _buildWanInject(
    c:  { tipo_auth: string | null; usuario_pppoe: string | null; password_pppoe: string | null;
          ip_asignada: string | null; mask: string | null; gateway: string | null; dns_primario: string | null },
    r:  { slot: number; port: number; onuId: number; vlan: number },
  ): { payload?: Omit<PythonFtthWanPppoeRequest, 'connection'>; error?: string } {
    const auth = (c.tipo_auth ?? 'pppoe').toLowerCase();
    const base = { slot: r.slot, port: r.port, onu_id: r.onuId, vlan: r.vlan };

    if (auth === 'pppoe') {
      let pass = c.password_pppoe ?? '';
      try { pass = decrypt(pass); } catch { /* no cifrado */ }
      if (!c.usuario_pppoe || !pass) {
        return { error: 'El contrato PPPoE no tiene credenciales. Active el servicio (secret en el MikroTik).' };
      }
      return { payload: { ...base, mode: 'pppoe', username: c.usuario_pppoe, password: pass } };
    }
    if (auth === 'amarre_ip_mac') {
      if (!c.ip_asignada || !c.mask) {
        return { error: 'Amarre IP/MAC sin IP o máscara. Asigna una IP de un segmento con CIDR válido.' };
      }
      return { payload: { ...base, mode: 'static', ip_address: c.ip_asignada, mask: c.mask,
                          gateway: c.gateway ?? undefined, pri_dns: c.dns_primario ?? undefined } };
    }
    if (auth === 'amarre_ip_mac_dhcp') {
      return { payload: { ...base, mode: 'dhcp' } };
    }
    return { error: `Método de autenticación "${auth}" no soportado para inyección WAN.` };
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
        connection:           conn,
        slot:                 registro.slot,
        port:                 registro.port,
        onu_id:               registro.onuId,
        service_port_id:      registro.servicePortId,
        mgmt_service_port_id: registro.mgmtServicePortId,
      }).catch((err: any) => {
        this.logger.error(`FTTH cancelar rollback falló | contrato=${contratoId}: ${err.message}`);
      });
    }

    await this.poolService.liberar(registro.oltId, contratoId).catch(() => { /* best-effort */ });
    await this.poolService.liberar(registro.oltId, contratoId, 'gestion').catch(() => { /* best-effort */ });
    await this.onuIdPool.liberar(registro.oltId, contratoId).catch(() => { /* best-effort */ });
    await this.ftthRepo.delete(registro.id);

    this.logger.warn(`FTTH cancelado | contrato=${contratoId} estado_previo=${registro.estado}`);
    return { cancelado: true, mensaje: 'Aprovisionamiento cancelado — no quedó nada registrado.' };
  }

  // ── actualizarWan ─────────────────────────────────────────────────
  // Re-inyecta la WAN PPPoE en la ONU con las credenciales ACTUALES del contrato.
  // Idempotente (`ont ipconfig ip-index 1` modifica la config existente). Se dispara
  // automáticamente al cambiar las credenciales PPPoE del contrato, y también manual.
  // Solo aplica a ONUs en modo ROUTING (en bridge la WAN vive en el router del cliente).
  async actualizarWan(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ actualizado: boolean; mensaje: string; error?: string; skipped?: boolean }> {
    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) {
      return { actualizado: false, skipped: true, mensaje: 'Contrato sin ONU FTTH — actualizar WAN omitido.' };
    }
    if (registro.wanMode !== 'routing') {
      return {
        actualizado: false, skipped: true,
        mensaje: 'ONU en modo bridge — la WAN/PPPoE la maneja el router del cliente (BRAS), no la ONU.',
      };
    }
    if (registro.estado !== FtthOnuEstado.ACTIVO) {
      return {
        actualizado: false, skipped: true,
        mensaje: `Estado "${registro.estado}": la WAN se actualiza solo en ONUs activas.`,
      };
    }

    const contrato  = await this._fetchContrato(contratoId, empresaId);

    // Si la VLAN del servicio cambió (p.ej. cambio de método → otro segmento con otra
    // VLAN), re-inyectar la WAN sola no basta: el service-port de la OLT sigue en la
    // VLAN vieja. Requiere Re-Aprovisionar (rehace service-port + WAN). Se evita
    // inyectar con la VLAN incorrecta.
    if (contrato.vlan_id != null && contrato.vlan_id !== registro.vlan) {
      return {
        actualizado: false, skipped: true,
        mensaje: `La VLAN del servicio cambió (${registro.vlan} → ${contrato.vlan_id}). ` +
                 `Usa "Re-Aprovisionar" para actualizar el service-port y la WAN.`,
      };
    }

    const wanInject = this._buildWanInject(contrato, registro);
    if (wanInject.error) {
      return { actualizado: false, mensaje: wanInject.error };
    }

    const olt  = await this._fetchOlt(registro.oltId, empresaId);
    const conn = this._buildConn(olt, this._decryptOltPassword(olt));

    this.logger.log(
      `FTTH actualizarWan | contrato=${contratoId} onu=${registro.slot}/${registro.port}/${registro.onuId} ` +
      `auth=${contrato.tipo_auth ?? 'pppoe'} mode=${wanInject.payload!.mode}`,
    );
    const wanRes = await this.automation.ftthInjectWanPppoe({ connection: conn, ...wanInject.payload! });

    if (!wanRes.success) {
      await this.ftthRepo.update(registro.id, { ultimoError: this._limpiar(wanRes.error) });
      return {
        actualizado: false,
        mensaje: 'No se pudo actualizar la WAN en la ONU. Reintenta o revisa el enlace.',
        error: wanRes.error,
      };
    }

    await this.ftthRepo.update(registro.id, { ultimoError: null });
    this.logger.log(`FTTH actualizarWan OK | contrato=${contratoId} mode=${wanInject.payload!.mode}`);
    return { actualizado: true, mensaje: `WAN actualizada en la ONU (${wanInject.payload!.mode}) con la config actual del contrato.` };
  }

  // ── verificarYRepararWanDrift ────────────────────────────────────────────
  // Watcher de re-inyección post factory-reset del flujo FTTH NATIVO (el que usa
  // el botón "Aprovisionar" — distinto del pipeline ZTP/TR-069 de
  // ztp.service.ts::reconcilePendingReinjection, que no cubre estas ONUs).
  //
  // Un factory-reset (por botón TR-069 o FÍSICO en el equipo) borra la config OMCI
  // de la ONU — incluida la WAN PPPoE — pero el registro del ERP la sigue marcando
  // "activo" sin que nada lo detecte. Sin trigger de evento para un reset físico,
  // la única forma de cubrir AMBOS casos es verificación de ESTADO REAL contra la
  // OLT: `display ont wan-info` confirma si la sesión PPPoE sigue viva con el
  // username correcto. Si no, se re-inyecta con `actualizarWan` (misma config del
  // contrato — idempotente). Diseñado para correr en cron (ver FtthWanWatcherCron).
  async verificarYRepararWanDrift(): Promise<{
    revisadas: number; ok: number; reparadas: number; fallidas: number;
  }> {
    const candidatos = await this.ds.query<{
      contrato_id: string; empresa_id: string; olt_id: string;
      slot: number; port: number; onu_id: number; usuario_pppoe: string | null;
    }[]>(
      `SELECT r.contrato_id, r.empresa_id, r.olt_id, r.slot, r.port, r.onu_id, c.usuario_pppoe
       FROM   ftth_onu_registro r
       JOIN   contratos c ON c.id = r.contrato_id
       WHERE  r.estado = 'activo' AND r.wan_mode = 'routing' AND r.deleted_at IS NULL
         AND  c.usuario_pppoe IS NOT NULL AND c.deleted_at IS NULL`,
    );

    let ok = 0, reparadas = 0, fallidas = 0;
    for (const c of candidatos) {
      try {
        const olt  = await this._fetchOlt(c.olt_id, c.empresa_id);
        const conn = this._buildConn(olt, this._decryptOltPassword(olt));
        const chk  = await this.automation.ftthCheckWan({
          connection: conn, slot: c.slot, port: c.port, onu_id: c.onu_id,
          expected_username: c.usuario_pppoe!,
        });
        if (chk.ok) { ok++; continue; }

        this.logger.warn(
          `verificarYRepararWanDrift: drift detectado | contrato=${c.contrato_id} ` +
          `connected=${chk.connected} username=${chk.username ?? '?'} (esperado ${c.usuario_pppoe})`,
        );
        const rep = await this.actualizarWan(c.contrato_id, c.empresa_id);
        if (rep.actualizado) reparadas++; else fallidas++;
      } catch (e) {
        fallidas++;
        this.logger.warn(`verificarYRepararWanDrift: contrato ${c.contrato_id} lanzó — ${(e as Error).message}`);
      }
    }

    if (reparadas > 0 || fallidas > 0) {
      this.logger.log(
        `verificarYRepararWanDrift: revisadas=${candidatos.length} ok=${ok} reparadas=${reparadas} fallidas=${fallidas}`,
      );
    }
    return { revisadas: candidatos.length, ok, reparadas, fallidas };
  }

  // ────────────────────────────────────────────────────────────
  // reconciliarTr069Drift — cron de reconciliación del canal CPE (incidente
  // CNT-2026-000004). Un ONT puede "olvidar" su config TR-069 tras un
  // factory-reset remoto, un power-cycle, o un reemplazo de equipo — sin que
  // nada en el flujo normal de aprovisionamiento se entere. Se detecta por
  // staleness de lastInform en GenieACS (no por Config state de la OLT: ya
  // se demostró que ese flag no es confiable para esto) y se repara
  // reejecutando bootstrapTr069, que a su vez delega en
  // ProvisioningStrategyResolver (circuit breaker por canal incluido).
  // ────────────────────────────────────────────────────────────
  private readonly TR069_DRIFT_STALENESS_MS = 2 * 60 * 60_000; // 2h sin Inform = drift

  async reconciliarTr069Drift(): Promise<{
    revisadas: number; ok: number; reparadas: number; fallidas: number;
  }> {
    if (!this.genieacs.isConfigured()) {
      return { revisadas: 0, ok: 0, reparadas: 0, fallidas: 0 }; // módulo degradado — no hay con qué verificar
    }

    const candidatos = await this.ftthRepo.find({
      where: { estado: FtthOnuEstado.ACTIVO, tr069BootstrapAplicado: true },
    });

    let ok = 0, reparadas = 0, fallidas = 0;
    for (const registro of candidatos) {
      try {
        const deviceId = `00259E-${registro.equipmentId ?? ''}-${registro.sn}`;
        const device = await this.genieacs.getDevice(deviceId).catch(() => null);
        const lastInform = device?._lastInform ? new Date(device._lastInform).getTime() : 0;

        if (Date.now() - lastInform < this.TR069_DRIFT_STALENESS_MS) { ok++; continue; }

        this.logger.warn(
          `reconciliarTr069Drift: drift detectado | contrato=${registro.contratoId} ` +
          `deviceId=${deviceId} lastInform=${device?._lastInform ?? 'nunca'}`,
        );

        const rep = await this.bootstrapTr069(registro.oltId, registro.empresaId, { contratoId: registro.contratoId });
        if (rep.exitoso) reparadas++; else fallidas++;
      } catch (e) {
        fallidas++;
        this.logger.warn(`reconciliarTr069Drift: contrato ${registro.contratoId} lanzó — ${(e as Error).message}`);
      }
    }

    if (reparadas > 0 || fallidas > 0) {
      this.logger.log(
        `reconciliarTr069Drift: revisadas=${candidatos.length} ok=${ok} reparadas=${reparadas} fallidas=${fallidas}`,
      );
    }
    return { revisadas: candidatos.length, ok, reparadas, fallidas };
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
        connection:           conn,
        slot:                 registro.slot,
        port:                 registro.port,
        onu_id:               registro.onuId,
        service_port_id:      registro.servicePortId,
        mgmt_service_port_id: registro.mgmtServicePortId,
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
  // ────────────────────────────────────────────────────────────
  // reaplicar — re-aprovisiona una ONU usando los datos ya guardados en su
  // registro FTTH. Es el push ERP→OLT de drift: cuando el ERP tiene la ONU
  // (contrato + registro) pero la OLT no (se perdió conexión, o la ONU se borró
  // en la OLT), re-corre provisionarFtth con los parámetros persistidos.
  // Se invoca desde el outbox (REAPROVISIONAR_ONU) con reintentos.
  // ────────────────────────────────────────────────────────────
  async reaplicar(contratoId: string, empresaId: string): Promise<FtthProvisionResult> {
    const reg = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!reg) {
      throw new NotFoundException('No hay registro FTTH para este contrato — no se puede re-aplicar.');
    }
    if (reg.lineprofileId == null || reg.srvprofileId == null) {
      throw new BadRequestException(
        'El registro no tiene perfiles GPON guardados — re-aprovisiona desde el modal del contrato.',
      );
    }
    const dto: ProvisionarFtthDto = {
      contratoId,
      frame:            reg.frame,
      slot:             reg.slot,
      port:             reg.port,
      onuId:            reg.onuId ?? undefined,
      sn:               reg.sn,
      servicePortId:    reg.servicePortId ?? undefined,
      vlan:             reg.vlan,
      lineprofileId:    reg.lineprofileId,
      srvprofileId:     reg.srvprofileId,
      trafficIndexDown: reg.trafficIndexDown ?? undefined,
      trafficIndexUp:   reg.trafficIndexUp ?? undefined,
      wanMode:          reg.wanMode ?? undefined,
    };
    // El carril de gestión TR-069 lo asegura provisionarFtth de forma intrínseca (punto
    // común), así que reaplicar no necesita restaurarlo aparte: reusa el service-port de
    // gestión del contrato en el pool y lo re-aplica idempotente.
    this.logger.log(`reaplicar | contrato=${contratoId} olt=${reg.oltId} sn=${reg.sn}`);
    return this.provisionarFtth(reg.oltId, empresaId, dto);
  }

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
