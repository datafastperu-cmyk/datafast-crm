import {
  BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, LessThan } from 'typeorm';
import {
  IsIn, IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { OltDispositivo }   from '../entities/olt-dispositivo.entity';
import { FtthOnuEstado, FtthCarrilEstado, FtthOnuRegistro, ftthNecesitaRecovery } from '../entities/ftth-onu-registro.entity';
import { FtthRollbackLog, RollbackMotivo } from '../entities/ftth-rollback-log.entity';
import { OltAutomationClient }            from '../olt-automation.client';
import { decrypt }                        from '../../../common/utils/encryption.util';
import { OltServicePortPoolService }      from './olt-service-port-pool.service';
import { FtthOperacionLockService }       from './ftth-operacion-lock.service';
import { OperacionWizardPasoService }     from './operacion-wizard-paso.service';
import { OltOnuIdPoolService }           from './olt-onu-id-pool.service';
import { OltMgmtIpPoolService }          from './olt-mgmt-ip-pool.service';
import { PythonOnuStatusInfo, PythonFtthWanPppoeRequest } from '../dto/olt-nativo-ops.dto';
import { conSelloDatafast } from '../capability/olt-baseline-standard';
import { ProvisioningStrategyResolver } from './cpe-provisioning/provisioning-strategy-resolver.service';
import { Tr069GenieacsClient } from '../../tr069/tr069-genieacs.client';
import { GenieAcsDriver } from '../ztp/genieacs.driver';
import {
  getTr069AcsUrl, getTr069AcsUsername, getTr069AcsPassword,
  getTr069ConnReqUsername, getTr069ConnReqPassword,
} from '../../../config/tr069-acs.config';

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
  // Procedimiento operativo (wizard) al que pertenece esta provisión. Si viene, cada paso
  // mutante se anota en la bitácora de compensación y el cierre sin confirmar puede
  // deshacerlo. Si no viene, el comportamiento es el histórico: la red de seguridad es
  // FtthRecoveryCron. Opcional a propósito — no rompe llamadores existentes (outbox, reaplicar).
  @IsOptional() @IsUUID('4')                          operacionId?:      string;
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
    private readonly genieDriver: GenieAcsDriver,

    private readonly opLock: FtthOperacionLockService,
    private readonly pasos:  OperacionWizardPasoService,
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
  // Punto de entrada público: toma el lock de exclusión mutua del contrato para que
  // NUNCA corra en paralelo con una desaprovisión/cancelación del mismo contrato
  // (causa raíz del ONT huérfano de 2026-07-21 — ver FtthOperacionLockService).
  async provisionarFtth(
    oltId:     string,
    empresaId: string,
    dto:       ProvisionarFtthDto,
  ): Promise<FtthProvisionResult> {
    return this.opLock.conLock(dto.contratoId, 'provision', () =>
      this._provisionarFtthInterno(oltId, empresaId, dto),
    );
  }

  private async _provisionarFtthInterno(
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

      // Respiro tras el rollback ANTES de volver a escribir en la OLT. El MA5800 procesa su
      // autosave de forma asíncrona tras un `ont delete`, y atacarlo de inmediato devuelve
      // "conflicts with other user operations": la Fase 1 gastaba 2 reintentos con backoff
      // (~30 s de los 115 s que costaba un re-aprovisionamiento, medido 2026-07-22). Esperar
      // aquí es más barato que reintentar después, porque cada reintento es un ciclo SSH
      // completo contra una OLT con pocas sesiones VTY concurrentes.
      await new Promise((r) => setTimeout(r, 6000));
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

    // ── Bitácora de compensación (Fase 2) ────────────────────────────────
    // Solo si el wizard declaró su procedimiento (`dto.operacionId`). Si no viene, el
    // comportamiento es el de siempre: la red de seguridad sigue siendo FtthRecoveryCron.
    // Los recursos ya reservados se anotan aquí; el paso de HARDWARE se anota más abajo,
    // write-ahead, justo antes de tocar la OLT.
    const opId = dto.operacionId ?? null;
    if (opId) {
      await this.pasos.registrarIntencion(
        opId, 'registro_ftth', `Registro FTTH del contrato ${dto.contratoId}`,
        { contratoId: dto.contratoId },
      ).then((id) => this.pasos.marcarAplicado(id)).catch(() => { /* la bitácora nunca aborta la provisión */ });

      if (usedSvcPool) {
        await this.pasos.registrarIntencion(
          opId, 'pool_service_port', `Service-port ${servicePortId} (datos)`,
          { oltId, contratoId: dto.contratoId, canal: 'datos' },
        ).then((id) => this.pasos.marcarAplicado(id)).catch(() => { /* idem */ });
      }
      await this.pasos.registrarIntencion(
        opId, 'pool_onu_id', `ONT-ID ${onuId} en ${dto.slot}/${dto.port}`,
        { oltId, contratoId: dto.contratoId },
      ).then((id) => this.pasos.marcarAplicado(id)).catch(() => { /* idem */ });
    }

    // ── Fase 1: GPON (con auto-sanado de colisión de service-port) ──
    // Si el índice asignado por el pool ya existe en la OLT, se marca como
    // no-usable y se reintenta con el siguiente del pool (hasta 3 veces).
    let gponRes: { success: boolean; error?: string };
    for (let intento = 0; ; intento++) {
      this.logger.log(`FTTH Fase1 GPON | contrato=${dto.contratoId} sn=${dto.sn} onuId=${onuId} svcPort=${servicePortId} intento=${intento + 1}`);

      // WRITE-AHEAD: la intención se escribe ANTES de tocar la OLT. Si el proceso muere
      // entre este INSERT y el `ont add`, el paso queda `en_vuelo` y el compensador ejecuta
      // igual el rollback (que es idempotente y verifica con `display ont info`). Escribirlo
      // después reintroduciría el huérfano exacto que arrastraba FtthRecoveryCron.
      let pasoGponId: string | null = null;
      if (opId) {
        pasoGponId = await this.pasos.registrarIntencion(
          opId, 'olt_gpon',
          `ont add ${dto.slot}/${dto.port} onu ${onuId} sn ${dto.sn} + service-port ${servicePortId}`,
          { oltId, contratoId: dto.contratoId, slot: dto.slot, port: dto.port, onuId, servicePortId },
          { tipo: 'display_ont_info', slot: dto.slot, port: dto.port, onuId },
        ).catch(() => null);
      }

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

      // El paso se cierra según el resultado REAL. Ante un fallo NO se marca `no_aplicado`:
      // un timeout o un 503 no prueban que la OLT no ejecutara el `ont add` (hoy mismo vimos
      // un `ont` creado tras un timeout del microservicio). Se deja `en_vuelo` para que el
      // compensador lo resuelva contra el hardware — "aceptado ≠ materializado" también vale
      // en el sentido inverso: "fallido ≠ no aplicado".
      if (pasoGponId && gponRes.success) {
        await this.pasos.marcarAplicado(pasoGponId).catch(() => { /* la bitácora no aborta */ });
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
      if (rbOk) {
        // OLT CONFIRMADA limpia → atómico: no queda NADA en el sistema.
        if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
        await this.onuIdPool.liberar(oltId, dto.contratoId);
        await this.ftthRepo.delete(registroId);
        return {
          estado:     FtthOnuEstado.FALLIDO_GPON,
          registroId,
          mensaje:    `Fase 1 (GPON) falló y se revirtió todo (OLT limpia). ${this._limpiar(gponRes.error) ?? ''}`.trim(),
          error:      gponRes.error,
        };
      }
      // INVARIANTE (atomicidad hardware↔ERP): el rollback NO se confirmó → la ONU puede
      // seguir configurada en la OLT. NUNCA se borra el registro (dejaría un `ont` huérfano
      // sin contrato). Se conserva vinculado en fallido_rollback, con los pools RETENIDOS,
      // para que el watcher reintente la limpieza hasta confirmarla.
      await this.ftthRepo.update(registroId, {
        estado:      FtthOnuEstado.FALLIDO_ROLLBACK,
        lockedAt:    null,
        ultimoError: `Fase 1 (GPON) falló y la limpieza en la OLT NO se confirmó — se reintenta automáticamente. ${this._limpiar(gponRes.error) ?? ''}`.trim(),
      });
      return {
        estado:     FtthOnuEstado.FALLIDO_ROLLBACK,
        registroId,
        mensaje:    'Fase 1 (GPON) falló y la limpieza de la OLT no se pudo confirmar. El registro se conserva vinculado al contrato; la limpieza se reintenta automáticamente.',
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
      if (rbOk) {
        // OLT CONFIRMADA limpia → atómico: no persiste nada.
        if (usedSvcPool) await this.poolService.liberar(oltId, dto.contratoId);
        await this.onuIdPool.liberar(oltId, dto.contratoId);
        await this.ftthRepo.delete(registroId);
        return {
          estado:     FtthOnuEstado.TIMEOUT_ONLINE,
          registroId,
          mensaje:    `La ONU no apareció online en 150 s tras el registro GPON (estado: ${runState}). Rollback ejecutado, OLT limpia.`,
          error:      rbErr,
        };
      }
      // INVARIANTE: rollback no confirmado → el `ont` puede seguir en la OLT. NUNCA se borra
      // el registro (huérfano). Se conserva vinculado en fallido_rollback (pools retenidos);
      // el watcher reintenta la limpieza.
      await this.ftthRepo.update(registroId, {
        estado:      FtthOnuEstado.FALLIDO_ROLLBACK,
        lockedAt:    null,
        ultimoError: `La ONU no apareció online (${runState}) y la limpieza en la OLT NO se confirmó — se reintenta automáticamente.`,
      });
      return {
        estado:     FtthOnuEstado.FALLIDO_ROLLBACK,
        registroId,
        mensaje:    'La ONU no apareció online y la limpieza de la OLT no se pudo confirmar. El registro se conserva vinculado al contrato; la limpieza se reintenta automáticamente.',
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
    const carrilNota = await this._ensureCarrilGestion(olt, dto.contratoId);

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
  // Flag de política (Fase 4): por defecto el carril TR-069 NO se inyecta con la provisión —
  // se activa BAJO DEMANDA desde el modal Ver ONU (toggle, Fase 2). Poner
  // INYECTAR_CARRIL_AUTOMATICO=true en el .env del VPS restaura el comportamiento intrínseco
  // (carril con cada aprovisionamiento). Leído en tiempo de llamada (portabilidad multi-VPS).
  private get _inyectarCarrilAutomatico(): boolean {
    return String(process.env.INYECTAR_CARRIL_AUTOMATICO).toLowerCase() === 'true';
  }

  private async _ensureCarrilGestion(
    olt:        OltDispositivo,
    contratoId: string,
  ): Promise<string> {
    if (!olt.tr069Enabled) return '';

    // Fase 4: carril desacoplado de la provisión. Sin el flag, la ONU queda con el plano de
    // datos OK y carril_estado='inactivo'; el operador lo activa cuando lo necesite (Ver ONU →
    // Activar TR-069). El drift-watcher IGNORA carriles 'inactivo', así que no lo revive.
    if (!this._inyectarCarrilAutomatico) {
      return ' El carril TR-069 no se inyectó (activación bajo demanda desde Ver ONU → Activar TR-069).';
    }

    // WIRING ÚNICO (directriz feedback_arquitectura_multicanal_provisioning): el carril SIEMPRE
    // pasa por bootstrapTr069 → ProvisioningStrategyResolver (catálogo por modelo + verificación
    // de convergencia real contra GenieACS, VIO). El flujo automático y el manual comparten un
    // solo orquestador.
    //
    // FIRE-AND-FORGET: el carril es inherentemente ASÍNCRONO — la ONU tiene que bootear, hacer
    // DHCP e informar (minutos). El resolver espera hasta 3 min esa convergencia; bloquear el
    // request de "Aprovisionar" en eso hacía que la provisión tardara y "fallara" aunque el
    // plano de datos ya estuviera OK. Se dispara en segundo plano: la provisión retorna de
    // inmediato y el drift-watcher (tr069-cpe-drift-watcher) reintenta/verifica el carril.
    void this.bootstrapTr069(olt.id, olt.empresaId, { contratoId })
      .then((r) => this.logger.log(`carril (async) | contrato=${contratoId}: ${r.exitoso ? 'OK' : 'pendiente'} — ${r.mensaje}`))
      .catch((e) => this.logger.warn(`carril (async) | contrato=${contratoId}: ${e instanceof Error ? e.message : String(e)}`));

    return ' Carril TR-069 en aplicación en segundo plano (se confirma por el watcher; la ONU aparecerá en el ACS al informar).';
  }

  // ── activarCarril (Fase 2 — toggle bajo demanda) ──────────────────
  // Punto de entrada del botón "Activar TR-069". Marca el carril `activando` (write-ahead) y
  // dispara el bootstrap en SEGUNDO PLANO (la convergencia tarda de segundos a ~5 min; no se
  // bloquea la request). El estado terminal (`activo` / `activacion_fallida`) lo fija el
  // propio bootstrap; un watcher resuelve cualquier `activando` que quede colgado por crash.
  // El lock por contrato se mantiene durante todo el bootstrap async (mutex con desaprovisión).
  async activarCarril(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ estado: FtthCarrilEstado; mensaje: string }> {
    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) throw new NotFoundException('Contrato sin ONU FTTH — no hay carril que activar.');
    if (registro.estado !== FtthOnuEstado.ACTIVO && registro.estado !== FtthOnuEstado.GPON_REGISTRADO) {
      throw new BadRequestException(`El carril solo se activa en ONUs "activo"/"gpon_registrado" (actual: "${registro.estado}").`);
    }
    // Idempotente: ya activo o ya en curso.
    if (registro.carrilEstado === FtthCarrilEstado.ACTIVO || registro.carrilEstado === FtthCarrilEstado.ACTIVANDO) {
      await this.ftthRepo.update(registro.id, { tr069UltimoUsoAt: new Date() });
      return { estado: registro.carrilEstado, mensaje: 'El carril TR-069 ya está activo o activándose.' };
    }

    // Lock manual (no `conLock`): se toma aquí y lo LIBERA el bootstrap async al terminar, para
    // que la request retorne de inmediato pero la desaprovisión no pueda colarse mientras se
    // escribe el carril. TTL amplio para cubrir la ventana de convergencia (6 min).
    const token = await this.opLock.adquirir(contratoId, 'tr069', 480);

    await this.ftthRepo.update(registro.id, {
      carrilEstado: FtthCarrilEstado.ACTIVANDO,
      tr069UltimoUsoAt: new Date(),
      ultimoError: null,
    });

    // Fire-and-forget con red de seguridad: el estado `activando` persistido + el watcher.
    // Reusa la identidad reservada si venía de `inactivo_reservado` (mgmtServicePortId ya guardado).
    void this.bootstrapTr069(registro.oltId, empresaId, {
      contratoId,
      mgmtServicePortId: registro.mgmtServicePortId ?? undefined,
      mgmtVlan:          registro.mgmtVlan ?? undefined,
      priority:          registro.mgmtPriority ?? undefined,
    })
      .then((r) => this.logger.log(`activarCarril | contrato=${contratoId}: ${r.exitoso ? 'activo' : 'activacion_fallida'} — ${r.mensaje}`))
      .catch((e) => this.logger.warn(`activarCarril | contrato=${contratoId}: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => this.opLock.liberar(contratoId, token));

    return {
      estado: FtthCarrilEstado.ACTIVANDO,
      mensaje: 'Activando el carril TR-069. La ONU aparecerá en el ACS al informar (~1-5 min).',
    };
  }

  // ── desactivarCarril (Fase 2 — toggle bajo demanda) ───────────────
  // Punto de entrada del botón "Desactivar TR-069". Quita SOLO el transporte (teardown),
  // PRESERVA los datos ACS del CPE y CONSERVA la identidad reservada (IP + service-port de
  // gestión con el contrato) para que reactivar sea idempotente y estable. Es rápido
  // (~10-30s) → síncrono. VIO: si el teardown no se confirma, queda `desactivacion_fallida`
  // y lo hereda el watcher.
  async desactivarCarril(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ estado: FtthCarrilEstado; mensaje: string }> {
    return this.opLock.conLock(contratoId, 'tr069', async () => {
      const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
      if (!registro) throw new NotFoundException('Contrato sin ONU FTTH — no hay carril que desactivar.');

      // Idempotente: ya inactivo.
      if (registro.carrilEstado === FtthCarrilEstado.INACTIVO ||
          registro.carrilEstado === FtthCarrilEstado.INACTIVO_RESERVADO) {
        await this.ftthRepo.update(registro.id, { tr069UltimoUsoAt: new Date() });
        return { estado: registro.carrilEstado, mensaje: 'El carril TR-069 ya está desactivado.' };
      }

      await this.ftthRepo.update(registro.id, { carrilEstado: FtthCarrilEstado.DESACTIVANDO });

      const olt  = await this._fetchOlt(registro.oltId, empresaId);
      const conn = this._buildConn(olt, this._decryptOltPassword(olt));
      const mgmtSp = await this._resolverMgmtServicePort(registro);

      const res = await this.automation.ftthTeardownTr069({
        connection: conn, slot: registro.slot, port: registro.port, onu_id: registro.onuId,
        mgmt_service_port_id: mgmtSp,
      }).catch((e) => ({ success: false, error: e instanceof Error ? e.message : String(e) }));

      if (!res.success) {
        await this.ftthRepo.update(registro.id, {
          carrilEstado: FtthCarrilEstado.DESACTIVACION_FALLIDA,
          ultimoError: `Desactivación TR-069 no confirmada: ${this._limpiar(res.error) ?? 'error'}`,
        });
        return { estado: FtthCarrilEstado.DESACTIVACION_FALLIDA, mensaje: 'No se pudo confirmar la desactivación; el watcher reintentará.' };
      }

      // Éxito: transporte quitado, identidad y datos ACS PRESERVADOS. tr069_bootstrap_aplicado
      // = false para que el drift-watcher deje de mantener el carril.
      await this.ftthRepo.update(registro.id, {
        carrilEstado: FtthCarrilEstado.INACTIVO_RESERVADO,
        tr069BootstrapAplicado: false,
        tr069UltimoUsoAt: new Date(),
        ultimoError: null,
      });
      return { estado: FtthCarrilEstado.INACTIVO_RESERVADO, mensaje: 'Carril TR-069 desactivado. Los datos ACS y la identidad se conservan; reactivar es inmediato.' };
    });
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

    // Carril ESTÁTICO (causa raíz 2026-07-17): requiere ACS URL (config de plataforma,
    // .env) y mgmtGateway del perfil TR-069 de la OLT, más una IP del pool de gestión.
    if (!getTr069AcsUrl() || !olt.tr069MgmtGateway) {
      throw new UnprocessableEntityException(
        'Configura TR069_ACS_URL en el .env del servidor y el gateway de gestión en el perfil TR-069 de la OLT antes de aplicar el carril.',
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

    // El catálogo de capacidad (cpe-provisioning-catalog.ts) necesita el modelo real
    // del CPE para saber qué canales aplican — si el registro no lo tiene aún
    // (ONU recién agregada, o registro creado antes de que existiera este campo),
    // se consulta a la OLT una sola vez y se persiste, para no depender de un
    // parche manual de BD en cada ONU (causa raíz: get_huawei_ont_version estuvo
    // roto — ver incidente 2026-07-18 — y nunca se pudo poblar automáticamente).
    let equipmentId = registro.equipmentId;
    let firmwareVersion = registro.firmwareVersion;
    if (!equipmentId) {
      try {
        const ver = await this.automation.ontVersion({
          connection: conn, slot: registro.slot, port: registro.port, onu_id: registro.onuId,
        });
        if (ver.success && ver.equipment_id) {
          equipmentId = ver.equipment_id;
          firmwareVersion = ver.software_version ?? null;
          await this.ftthRepo.update(registro.id, { equipmentId, firmwareVersion });
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo obtener equipment_id de la OLT | registro=${registro.id}: ${err?.message}`);
      }
    }
    // Fallback de detección de modelo: si la OLT no lo reportó (ontVersion falla en algunos
    // firmwares), leer el ProductClass que la ONU reporta a GenieACS por SN — persiste ahí
    // aunque la ONU se haya factory-reseteado. Evita CPE_MODEL_NOT_SUPPORTED al re-aprovisionar
    // una ONU ya conocida (el resolver necesita el modelo para elegir el canal del catálogo).
    if (!equipmentId) {
      try {
        const pc = await this.genieDriver.getProductClassBySerial(registro.sn);
        if (pc) {
          equipmentId = pc;
          await this.ftthRepo.update(registro.id, { equipmentId });
          this.logger.log(`equipment_id resuelto por GenieACS | registro=${registro.id}: ${pc}`);
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo leer ProductClass de GenieACS | registro=${registro.id}: ${err?.message}`);
      }
    }

    // DISP: la decisión de "por qué canal" (OMCI, HTTP-CPE, u otro futuro) NO
    // se resuelve aquí — se delega al ProvisioningStrategyResolver, que consulta
    // el catálogo de capacidad del dispositivo y verifica convergencia real
    // contra GenieACS antes de reportar éxito (VIO: aceptado ≠ confirmado).
    const resolverResult = await this.cpeResolver.ejecutarBootstrap({
      device: {
        fabricante: olt.marca,
        modelo:     equipmentId ?? 'DESCONOCIDO',
        firmware:   firmwareVersion ?? null,
        sn:         registro.sn,
        mgmtIp,
      },
      acsUrl:          getTr069AcsUrl(),
      acsUsername:     getTr069AcsUsername() || 'tr069',
      acsPassword:     getTr069AcsPassword(),
      connReqUsername: getTr069ConnReqUsername() || undefined,
      connReqPassword: getTr069ConnReqPassword() || undefined,
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
      // SAFETY NET VIO (causa raíz 2026-07-21, CNT-2026-000004): el canal puede reportar
      // fallo por un choque transitorio del CLI (p.ej. "% Unknown command" tras un
      // "conflicts with other user operations" de autosave en el reintento) AUNQUE el carril
      // ya se haya materializado — el DHCP+Inform es asíncrono y llega ~60-90s después. Hacer
      // rollback duro aquí liberaba el service-port de gestión y marcaba el carril como no
      // aplicado mientras la ONU YA estaba gestionada por TR-069 (registro↔OLT↔pool
      // desincronizados). Antes de deshacer, se confirma la materialización REAL contra
      // GenieACS: si la ONU informa dentro de la ventana, el carril vive → se persiste como
      // éxito y se CONSERVA el service-port. La verdad observable manda sobre el eco del CLI.
      const materializado = await this.cpeResolver.confirmarConvergencia({
        fabricante: olt.marca,
        modelo:     equipmentId ?? 'DESCONOCIDO',
        sn:         registro.sn,
      });
      if (!materializado) {
        // Devolver el service-port de gestión al pool si lo tomamos nosotros (rollback).
        if (asignadoDelPool) {
          await this.poolService.liberar(oltId, dto.contratoId, 'gestion').catch(() => { /* best-effort */ });
        }
        await this.ftthRepo.update(registro.id, {
          ultimoError: this._limpiar(resolverResult.mensaje),
          carrilEstado: FtthCarrilEstado.ACTIVACION_FALLIDA,
        });
        return {
          exitoso: false,
          mensaje: resolverResult.mensaje,
          error:   resolverResult.intentos.map((i) => `${i.canal}: ${i.mensaje}`).join(' | '),
        };
      }
      this.logger.warn(
        `FTTH bootstrapTr069: el canal reportó fallo pero GenieACS confirma Inform — carril ` +
        `MATERIALIZADO (VIO), se conserva el service-port | contrato=${dto.contratoId} onu=${registro.slot}/${registro.port}/${registro.onuId}`,
      );
      // Cae al bloque de persistencia de éxito de abajo.
    }

    // Persistir el estado del carril para poder RESTAURARLO tras un re-aprovisionamiento
    // (la OLT borra los service-ports de la ONU al re-registrarla). Se guarda el mismo
    // mgmtServicePortId (ya asignado a este contrato en el pool) para reutilizarlo idéntico.
    await this.ftthRepo.update(registro.id, {
      ultimoError:            null,
      tr069BootstrapAplicado: true,
      carrilEstado:           FtthCarrilEstado.ACTIVO,
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

  /**
   * Service-port del carril de gestión, con el POOL como respaldo del registro.
   *
   * El carril asigna el ID en el pool y RECIÉN DESPUÉS lo persiste en el registro. Si el
   * procedimiento se interrumpe entre ambos —o el carril async falla su verificación— el
   * registro queda con `mgmt_service_port_id` NULL mientras el service-port SÍ existe en la
   * OLT. Confiar solo en el registro hacía que `ont delete` fallara para siempre con
   * "This configured object has some service virtual ports" (observado 2026-07-22 en el
   * compensador y, con la misma causa, en esta ruta de desaprovisión).
   *
   * Se consulta incluso el pool ya liberado: un carril cuyo bootstrap dio falso negativo
   * devuelve el ID al pool pero deja el service-port vivo en la OLT.
   */
  private async _resolverMgmtServicePort(registro: FtthOnuRegistro): Promise<number | null> {
    if (registro.mgmtServicePortId != null) return registro.mgmtServicePortId;

    const [fila] = await this.ds.query<{ service_port_id: number }[]>(
      `SELECT service_port_id FROM olt_service_port_pool
       WHERE olt_id = $1 AND contrato_id = $2 AND canal = 'gestion' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [registro.oltId, registro.contratoId],
    ).catch(() => [] as { service_port_id: number }[]);

    if (fila?.service_port_id != null) {
      this.logger.warn(
        `mgmt service-port resuelto por POOL (registro lo tenía NULL) | ` +
        `contrato=${registro.contratoId} svcPort=${fila.service_port_id}`,
      );
      return fila.service_port_id;
    }
    return null;
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
    // ── Regla C — guard de reactivación (ruta AUTOMÁTICA/tumba, outbox) ──
    // Esta ruta la dispara la baja (encolarDesaprovisionarOnu) y el outbox la reintenta hasta
    // que la OLT esté disponible. Entre el encolado y la ejecución el contrato PUDO reactivarse
    // (OLT caída horas → cliente vuelve a contratar). Ejecutar la tumba a ciegas cortaría a un
    // cliente en producción — exactamente lo que la directriz prohíbe. Se revalida el estado
    // vivo del contrato: la limpieza SOLO procede sobre una tumba real (baja/eliminado). El
    // botón manual `desaprovisionar` NO pasa por aquí, así que la acción explícita del operador
    // nunca se bloquea.
    const [contrato] = await this.ds.query<Array<{ estado: string; deleted_at: string | null }>>(
      `SELECT estado, deleted_at FROM contratos WHERE id = $1 AND empresa_id = $2`,
      [contratoId, empresaId],
    );
    if (!contrato) {
      // Contrato borrado en duro: la tumba sigue siendo válida (hay que limpiar el hardware).
      this.logger.log(`desaprovisionarPorContrato | contrato=${contratoId} inexistente en BD — se procede a limpiar hardware.`);
    } else {
      const esTumba = contrato.estado === 'baja_definitiva' || contrato.deleted_at !== null;
      if (!esTumba) {
        this.logger.warn(
          `desaprovisionarPorContrato | contrato=${contratoId} estado=${contrato.estado} NO es tumba ` +
          `(reactivado antes de drenar el outbox) — desaprovisión omitida (Regla C).`,
        );
        return { exitoso: true, skipped: true, mensaje: 'Contrato reactivado — desaprovisión automática omitida para no cortar servicio activo.' };
      }
    }

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
  // El cierre del wizard llama aquí. Si hay una provisión EN VUELO, el lock la
  // rechaza con 409 a propósito: cancelar a mitad de una provisión activa es
  // exactamente la carrera que dejó el ONT huérfano. La provisión en curso
  // termina sola de forma atómica (fix A: nunca borra el registro con la OLT sucia).
  async cancelarFtth(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ cancelado: boolean; mensaje: string }> {
    return this.opLock.conLock(contratoId, 'cancelacion', () =>
      this._cancelarFtthInterno(contratoId, empresaId),
    );
  }

  private async _cancelarFtthInterno(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ cancelado: boolean; mensaje: string }> {
    // CONVERGENCIA de las dos rutas de anulación: cualquier cancelación —venga del modal,
    // del outbox o de donde sea— marca también el procedimiento del wizard para que el
    // compensador deshaga su bitácora. Mantener dos caminos independientes era justo el
    // tipo de duplicidad que produce los bugs que veníamos persiguiendo. Ambas rutas son
    // idempotentes, así que ejecutar las dos no causa daño.
    await this.ds.query(
      `UPDATE operacion_wizard
       SET estado = 'anulando', cerrado_en = NOW(),
           motivo_cierre = COALESCE(motivo_cierre, 'Cancelación del procedimiento'),
           updated_at = NOW()
       WHERE recurso_ref = $1 AND estado = 'en_curso'`,
      [contratoId],
    ).catch(() => { /* best-effort: el TTL del servidor lo cubre igual */ });

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

    // Rollback en la OLT — su resultado DECIDE si se puede borrar el registro. INVARIANTE:
    // nunca borrar con la OLT posiblemente sucia (dejaría un `ont` huérfano sin contrato).
    let rbOk = false;
    let rbErr: string | undefined;
    const olt = await this._fetchOlt(registro.oltId, empresaId).catch(() => null);
    if (olt) {
      const conn = this._buildConn(olt, this._decryptOltPassword(olt));
      try {
        const res = await this.automation.ftthRollbackGpon({
          connection:           conn,
          slot:                 registro.slot,
          port:                 registro.port,
          onu_id:               registro.onuId,
          service_port_id:      registro.servicePortId,
          mgmt_service_port_id: registro.mgmtServicePortId,
        });
        rbOk  = res.success;
        rbErr = res.error;
      } catch (err: any) {
        rbErr = err.message;
        this.logger.error(`FTTH cancelar rollback falló | contrato=${contratoId}: ${err.message}`);
      }
    } else {
      rbErr = 'No se pudo conectar a la OLT para limpiar la ONU.';
    }

    if (!rbOk) {
      // La OLT no se confirmó limpia → se conserva el registro vinculado en fallido_rollback
      // (pools RETENIDOS); el watcher reintenta la limpieza hasta confirmarla.
      await this.ftthRepo.update(registro.id, {
        estado:      FtthOnuEstado.FALLIDO_ROLLBACK,
        lockedAt:    null,
        ultimoError: `Cancelación: la limpieza en la OLT NO se confirmó — se reintenta automáticamente. ${this._limpiar(rbErr) ?? ''}`.trim(),
      });
      return {
        cancelado: false,
        mensaje: 'No se pudo confirmar la limpieza de la ONU en la OLT. El registro se conserva vinculado al contrato; la limpieza se reintenta automáticamente.',
      };
    }

    // OLT CONFIRMADA limpia → liberar pools + borrar registro.
    await this.poolService.liberar(registro.oltId, contratoId).catch(() => { /* best-effort */ });
    await this.poolService.liberar(registro.oltId, contratoId, 'gestion').catch(() => { /* best-effort */ });
    await this.onuIdPool.liberar(registro.oltId, contratoId).catch(() => { /* best-effort */ });
    await this.ftthRepo.delete(registro.id);

    this.logger.warn(`FTTH cancelado | contrato=${contratoId} estado_previo=${registro.estado}`);
    return { cancelado: true, mensaje: 'Aprovisionamiento cancelado — OLT limpia, nada quedó registrado.' };
  }

  // ── reintentarRollbacksFallidos ───────────────────────────────────
  // Watcher del INVARIANTE de atomicidad hardware↔ERP: los registros que quedaron en
  // `fallido_rollback` (el rollback en la OLT no se pudo confirmar) siguen VINCULADOS al
  // contrato — nunca huérfanos. Este watcher reintenta la limpieza real de la OLT; SOLO
  // cuando la OLT queda confirmada limpia libera los pools y borra el registro. Mientras
  // no se confirme, el registro persiste (con su error). Diseñado para correr en cron.
  // ── carrilStats (Fase 0 — observabilidad) ─────────────────────────
  // Línea base de carriles TR-069 por estado, para el health/dashboard. Permite tener la
  // curva desde el día uno (antes de que la migración de SmartOLT multiplique la base) sin
  // esperar a que el toggle esté en uso. `bajas_pendientes` llega en la Fase 5.
  async carrilStats(empresaId: string): Promise<{ porEstado: Record<string, number>; activos: number }> {
    const rows = await this.ds.query<{ carril_estado: string; n: string }[]>(
      `SELECT carril_estado, COUNT(*)::text AS n
       FROM   ftth_onu_registro
       WHERE  empresa_id = $1 AND deleted_at IS NULL
       GROUP  BY carril_estado`,
      [empresaId],
    );
    const porEstado: Record<string, number> = {};
    for (const r of rows) porEstado[r.carril_estado] = Number(r.n);
    const activos = (porEstado['activo'] ?? 0) + (porEstado['activando'] ?? 0);
    return { porEstado, activos };
  }

  async reintentarRollbacksFallidos(): Promise<{ revisados: number; limpiados: number; pendientes: number }> {
    const registros = await this.ftthRepo.find({ where: { estado: FtthOnuEstado.FALLIDO_ROLLBACK } });
    let limpiados = 0, pendientes = 0;
    for (const r of registros) {
      try {
        const olt  = await this._fetchOlt(r.oltId, r.empresaId);
        const conn = this._buildConn(olt, this._decryptOltPassword(olt));
        const res  = await this.automation.ftthRollbackGpon({
          connection: conn, slot: r.slot, port: r.port, onu_id: r.onuId,
          service_port_id: r.servicePortId, mgmt_service_port_id: r.mgmtServicePortId,
        });
        if (res.success) {
          await Promise.all([
            this.poolService.liberar(r.oltId, r.contratoId).catch(() => { /* best-effort */ }),
            this.poolService.liberar(r.oltId, r.contratoId, 'gestion').catch(() => { /* best-effort */ }),
            this.onuIdPool.liberar(r.oltId, r.contratoId).catch(() => { /* best-effort */ }),
          ]);
          await this.ftthRepo.delete(r.id);
          limpiados++;
          this.logger.log(`fallido_rollback limpiado | contrato=${r.contratoId} — OLT confirmada limpia, recursos liberados`);
        } else {
          pendientes++;
          await this.ftthRepo.update(r.id, { ultimoError: `Limpieza OLT aún no confirmada: ${this._limpiar(res.error) ?? 'error'}` });
        }
      } catch (e) {
        pendientes++;
        this.logger.warn(`reintentarRollbacksFallidos: contrato ${r.contratoId} lanzó — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (limpiados > 0 || pendientes > 0) {
      this.logger.log(`reintentarRollbacksFallidos: revisados=${registros.length} limpiados=${limpiados} pendientes=${pendientes}`);
    }
    return { revisados: registros.length, limpiados, pendientes };
  }

  // ── adoptarOnusHuerfanas ──────────────────────────────────────────
  // Cara CREATE del invariante de atomicidad hardware↔ERP (complementa a
  // `reintentarRollbacksFallidos`, que cubre la cara DELETE): si por un fallo entre el
  // registro GPON en la OLT y la persistencia del registro (crash, corte, op manual) queda
  // una ONU aprovisionada en la OLT y VINCULADA a un contrato vigente pero SIN
  // `ftth_onu_registro`, este watcher la ADOPTA — reconstruye el registro con estado real.
  //
  // Reconstrucción a partir de estado que el ERP posee (no de parsing frágil de la OLT):
  //   · posición física + SN + contrato → `olt_onu_inventario` (snapshot SSH del reconcile).
  //   · service-ports asignados         → `olt_service_port_pool` (el ERP retiene la
  //                                        asignación en toda ruta de fallo — ver fix A).
  //   · VLAN de cada service-port       → lectura VIVA de la OLT (`servicePorts`), que además
  //                                        CONFIRMA (VIO) que el service-port existe de verdad
  //                                        en el plano operativo antes de adoptar.
  // No se fabrica ningún dato: si el pool no retiene la asignación de datos, o la OLT no
  // confirma el service-port, NO se adopta (se deja para reporte). Los perfiles y el wan_mode
  // no son recuperables con certeza → se adopta conservador (wan_mode='bridge', perfiles NULL)
  // y se deja constancia explícita en `ultimo_error` para revisión del operador.
  async adoptarOnusHuerfanas(): Promise<{ candidatas: number; adoptadas: number; omitidas: number }> {
    const orphans = await this.ds.query<{
      empresa_id: string; olt_id: string; slot: number; port: number; onu_id: number;
      sn: string; contrato_id: string; numero_contrato: string | null;
      tipo_auth: string | null; data_sp: number; mgmt_sp: number | null;
    }[]>(`
      SELECT inv.empresa_id, inv.olt_id, inv.slot, inv.port, inv.onu_id, inv.sn,
             inv.contrato_id, inv.numero_contrato, c.tipo_auth,
             pd.service_port_id AS data_sp,
             pg.service_port_id AS mgmt_sp
      FROM   olt_onu_inventario inv
      JOIN   contratos c
             ON c.id = inv.contrato_id AND c.deleted_at IS NULL AND c.estado <> 'baja_definitiva'
      JOIN   olt_service_port_pool pd
             ON pd.contrato_id = inv.contrato_id AND pd.olt_id = inv.olt_id
            AND pd.canal = 'datos' AND pd.estado = 'ocupado'
      LEFT   JOIN olt_service_port_pool pg
             ON pg.contrato_id = inv.contrato_id AND pg.olt_id = inv.olt_id
            AND pg.canal = 'gestion' AND pg.estado = 'ocupado'
      WHERE  inv.sin_contrato = false
        AND  inv.contrato_id IS NOT NULL
        AND  inv.estado_operativo <> 'no_aprovisionada'
        AND  NOT EXISTS (SELECT 1 FROM ftth_onu_registro f WHERE f.contrato_id = inv.contrato_id)
    `);

    if (orphans.length === 0) return { candidatas: 0, adoptadas: 0, omitidas: 0 };

    let adoptadas = 0, omitidas = 0;
    // Cache de service-ports vivos por OLT (una sola lectura SSH por OLT en el ciclo).
    const portsCache = new Map<string, Map<number, number>>();

    for (const o of orphans) {
      try {
        let vlanByIndex = portsCache.get(o.olt_id);
        if (!vlanByIndex) {
          const olt  = await this._fetchOlt(o.olt_id, o.empresa_id);
          const conn = this._buildConn(olt, this._decryptOltPassword(olt));
          const res  = await this.automation.servicePorts({ connection: conn });
          if (!res.success) {
            omitidas++;
            this.logger.warn(`adoptarOnusHuerfanas: no se pudo leer service-ports de OLT ${o.olt_id} — omitido contrato ${o.contrato_id}`);
            continue;
          }
          vlanByIndex = new Map(res.ports.map(p => [p.index, p.vlan_id]));
          portsCache.set(o.olt_id, vlanByIndex);
        }

        // VIO: el service-port de datos debe existir REALMENTE en la OLT para adoptar.
        const dataVlan = vlanByIndex.get(o.data_sp);
        if (dataVlan == null) {
          omitidas++;
          this.logger.warn(
            `adoptarOnusHuerfanas: service-port datos ${o.data_sp} NO confirmado en OLT ` +
            `${o.olt_id} — no se adopta contrato ${o.contrato_id} (posible drift real).`,
          );
          continue;
        }
        const mgmtVlan = o.mgmt_sp != null ? vlanByIndex.get(o.mgmt_sp) ?? null : null;

        const wanMode = o.tipo_auth === 'pppoe' ? 'routing' : 'bridge';
        const nota =
          `Adoptado por reconciliador ${new Date().toISOString()} — registro reconstruido tras ` +
          `huérfano ONU↔contrato. REVISAR: wan_mode='${wanMode}' y perfiles (lineprofile/srvprofile) ` +
          `no recuperables; usar Re-Aprovisionar si el modo/perfil difiere.`;

        const ins = await this.ds.query<{ id: string }[]>(`
          INSERT INTO ftth_onu_registro
            (empresa_id, contrato_id, olt_id, frame, slot, port, onu_id, sn,
             service_port_id, vlan, wan_mode, estado,
             mgmt_service_port_id, mgmt_vlan, tr069_bootstrap_aplicado, ultimo_error)
          VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10,'activo',$11,$12,$13,$14)
          ON CONFLICT (contrato_id) DO NOTHING
          RETURNING id
        `, [
          o.empresa_id, o.contrato_id, o.olt_id, o.slot, o.port, o.onu_id, o.sn,
          o.data_sp, dataVlan, wanMode, o.mgmt_sp, mgmtVlan, o.mgmt_sp != null, nota,
        ]);

        if (ins.length > 0) {
          adoptadas++;
          this.logger.warn(
            `adoptarOnusHuerfanas: ADOPTADA sn=${o.sn} ${o.slot}/${o.port}/${o.onu_id} ` +
            `contrato=${o.numero_contrato ?? o.contrato_id} data_sp=${o.data_sp}/vlan${dataVlan} ` +
            `mgmt_sp=${o.mgmt_sp ?? '-'}/vlan${mgmtVlan ?? '-'} wan_mode=${wanMode}`,
          );
        } else {
          omitidas++; // colisión de contrato_id (registro soft-deleted) — no adoptar
        }
      } catch (e) {
        omitidas++;
        this.logger.warn(`adoptarOnusHuerfanas: contrato ${o.contrato_id} lanzó — ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this.logger.log(`adoptarOnusHuerfanas: candidatas=${orphans.length} adoptadas=${adoptadas} omitidas=${omitidas}`);
    return { candidatas: orphans.length, adoptadas, omitidas };
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

    // MIGRADO a `carril_estado` (Fase 2): un carril DESACTIVADO intencionalmente
    // (`inactivo`/`inactivo_reservado`) NUNCA es drift — no se revive. Se atienden:
    //   · 'activo'                → drift check (staleness de lastInform) → rebootstrap si stale.
    //   · 'activacion_fallida'    → reintento del bootstrap (aceptado sin converger).
    //   · 'activando' colgado     → crash a media activación → reintento.
    //   · 'desactivacion_fallida' → reintento del teardown (VIO al deshacer).
    const reintentables = await this.ftthRepo.find({
      where: {
        estado: FtthOnuEstado.ACTIVO,
        carrilEstado: In([
          FtthCarrilEstado.ACTIVO,
          FtthCarrilEstado.ACTIVACION_FALLIDA,
          FtthCarrilEstado.DESACTIVACION_FALLIDA,
        ]),
      },
    });
    const stuckActivando = await this.ftthRepo.find({
      where: {
        estado: FtthOnuEstado.ACTIVO,
        carrilEstado: FtthCarrilEstado.ACTIVANDO,
        updatedAt: LessThan(new Date(Date.now() - 10 * 60_000)),
      },
    });
    const candidatos = [...reintentables, ...stuckActivando];

    let ok = 0, reparadas = 0, fallidas = 0;
    for (const registro of candidatos) {
      try {
        // Desactivación no confirmada → reintentar el teardown, no el bootstrap.
        if (registro.carrilEstado === FtthCarrilEstado.DESACTIVACION_FALLIDA) {
          const r = await this.desactivarCarril(registro.contratoId, registro.empresaId).catch(() => null);
          if (r?.estado === FtthCarrilEstado.INACTIVO_RESERVADO) reparadas++; else fallidas++;
          continue;
        }

        // Estados de activación: 'activo' se revisa por drift; el resto se reintenta directo.
        if (registro.carrilEstado === FtthCarrilEstado.ACTIVO) {
          const deviceId = `00259E-${registro.equipmentId ?? ''}-${registro.sn}`;
          const device = await this.genieacs.getDevice(deviceId).catch(() => null);
          const lastInform = device?._lastInform ? new Date(device._lastInform).getTime() : 0;
          if (Date.now() - lastInform < this.TR069_DRIFT_STALENESS_MS) { ok++; continue; }
          this.logger.warn(
            `reconciliarTr069Drift: drift detectado | contrato=${registro.contratoId} ` +
            `deviceId=${deviceId} lastInform=${device?._lastInform ?? 'nunca'}`,
          );
        }

        const rep = await this.bootstrapTr069(registro.oltId, registro.empresaId, {
          contratoId:        registro.contratoId,
          mgmtServicePortId: registro.mgmtServicePortId ?? undefined,
          mgmtVlan:          registro.mgmtVlan ?? undefined,
          priority:          registro.mgmtPriority ?? undefined,
        });
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

  // ────────────────────────────────────────────────────────────
  // Fase 3 — barrido TTL del carril TR-069.
  //
  // Un carril activo que nadie usa por N días se desactiva solo (quita el
  // transporte, conserva identidad + datos ACS). El "uso" es interacción REAL
  // del operador (abrir el modal / togglear) — `tr069UltimoUsoAt`. NO existe un
  // heartbeat automático que infle esa marca, así que un carril sin uso genuino
  // converge al TTL sin necesidad de techo absoluto: la reparación por drift NO
  // toca `tr069UltimoUsoAt` (a propósito), luego un rebootstrap del watcher no
  // "resucita" el TTL. COALESCE con updatedAt cubre carriles legados con marca
  // NULL (activados antes de la Fase 0) sin barrerlos de inmediato.
  //
  // N configurable por VPS vía env (default 3 días). Portabilidad: leído en
  // tiempo de llamada, nunca constante de módulo.
  // ────────────────────────────────────────────────────────────
  private get _tr069TtlDias(): number {
    const n = Number(process.env.TR069_CARRIL_TTL_DIAS);
    return Number.isFinite(n) && n > 0 ? n : 3;
  }

  async barrerCarrilesTr069Inactivos(): Promise<
    Array<{ contratoId: string; estado: FtthCarrilEstado; ok: boolean; mensaje: string }>
  > {
    const dias = this._tr069TtlDias;
    const candidatos = await this.ds.query<Array<{ contrato_id: string; empresa_id: string }>>(
      `SELECT contrato_id, empresa_id
         FROM ftth_onu_registro
        WHERE deleted_at IS NULL
          AND estado = 'activo'
          AND carril_estado = 'activo'
          AND COALESCE(tr069_ultimo_uso_at, updated_at) < NOW() - ($1 || ' days')::interval`,
      [String(dias)],
    );

    const resultados: Array<{ contratoId: string; estado: FtthCarrilEstado; ok: boolean; mensaje: string }> = [];
    for (const c of candidatos) {
      try {
        const r = await this.desactivarCarril(c.contrato_id, c.empresa_id);
        const ok = r.estado === FtthCarrilEstado.INACTIVO_RESERVADO || r.estado === FtthCarrilEstado.INACTIVO;
        resultados.push({ contratoId: c.contrato_id, estado: r.estado, ok, mensaje: r.mensaje });
      } catch (e) {
        resultados.push({
          contratoId: c.contrato_id,
          estado: FtthCarrilEstado.DESACTIVACION_FALLIDA,
          ok: false,
          mensaje: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (resultados.length > 0) {
      this.logger.log(
        `barrerCarrilesTr069Inactivos: ttl=${dias}d candidatos=${candidatos.length} ` +
        `desactivados=${resultados.filter(r => r.ok).length} fallidos=${resultados.filter(r => !r.ok).length}`,
      );
    }
    return resultados;
  }

  // Estado operativo de la ONU leído DIRECTO de la OLT (plano independiente del TR-069).
  // Es la señal VIO para confirmar la materialización de un reinicio/factory-reset: el
  // "Last up time" cambia solo cuando la ONU realmente reinició. NO se usa el uptime de
  // GenieACS (queda rancio → falsos negativos).
  async leerOntEstadoOlt(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ ok: boolean; lastUpTime: string | null; runState: string | null }> {
    const registro = await this.ftthRepo.findOne({ where: { contratoId, empresaId } });
    if (!registro) return { ok: false, lastUpTime: null, runState: null };
    try {
      const olt  = await this._fetchOlt(registro.oltId, empresaId);
      const conn = this._buildConn(olt, this._decryptOltPassword(olt));
      const res  = await this.automation.diagnosticDisplay(conn, [
        `display ont info 0 ${registro.slot} ${registro.port} ${registro.onuId}`,
      ]);
      const out = res.outputs?.[0]?.output ?? '';
      const up  = /Last up time\s*:\s*([^\r\n]+)/.exec(out)?.[1]?.trim() ?? null;
      const rs  = /Run state\s*:\s*(\S+)/.exec(out)?.[1] ?? null;
      return { ok: Boolean(up || rs), lastUpTime: up, runState: rs };
    } catch (e) {
      this.logger.warn(`leerOntEstadoOlt | contrato=${contratoId}: ${(e as Error).message}`);
      return { ok: false, lastUpTime: null, runState: null };
    }
  }

  // Marca de uso del carril (interacción real del operador: abrir el modal Ver ONU).
  // Es lo que suprime el barrido TTL. Best-effort — nunca lanza.
  async marcarUsoTr069(contratoId: string, empresaId: string): Promise<void> {
    await this.ftthRepo.update({ contratoId, empresaId }, { tr069UltimoUsoAt: new Date() })
      .catch(() => { /* best-effort: un fallo al sellar el uso no debe romper la apertura del modal */ });
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
    return this.opLock.conLock(dto.contratoId, 'desaprovision', () =>
      this._desaprovisionarInterno(oltId, empresaId, dto),
    );
  }

  private async _desaprovisionarInterno(
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
      FtthOnuEstado.FALLIDO_ROLLBACK,   // permite forzar la limpieza manual además del watcher
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
        mgmt_service_port_id: await this._resolverMgmtServicePort(registro),
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

    // Se liberan AMBOS canales del pool y la IP de gestión. Antes solo se soltaba 'datos':
    // el service-port de gestión quedaba 'ocupado' para siempre aunque ya no existiera en la
    // OLT (fuga observada 2026-07-22 — el 2001 seguía retenido tras desaprovisionar). Con el
    // tiempo eso agota el pool con IDs fantasma. `liberar` es idempotente.
    await Promise.all([
      this.poolService.liberar(oltId, dto.contratoId),
      this.poolService.liberar(oltId, dto.contratoId, 'gestion'),
      this.onuIdPool.liberar(oltId, dto.contratoId),
      this.mgmtIpPool.liberar(oltId, dto.contratoId).catch(() => { /* puede no tener IP asignada */ }),
    ]);

    // Regla D — limpieza terminal del device en GenieACS. La ONU deja de existir en la OLT
    // (rollback_gpon borró el `ont`), así que su device en el ACS queda fantasma: nunca más
    // informará y solo ensucia el inventario. Se borra por SN (tolera legible↔hex, VIO al
    // confirmar). Best-effort: NUNCA bloquea la baja — si el ACS está caído, el device muerto
    // es inocuo y el próximo re-uso del SN lo recrea limpio.
    if (this.genieacs.isConfigured()) {
      await this.genieDriver.wipeDeviceBySerial(registro.sn)
        .then((r) => this.logger.log(`desaprovisionar | ACS wipe sn=${registro.sn}: ${r.borrado ? 'borrado' : 'no confirmado'} (device=${r.deviceId ?? 'inexistente'})`))
        .catch((e) => this.logger.warn(`desaprovisionar | ACS wipe sn=${registro.sn} falló (no bloquea baja): ${e instanceof Error ? e.message : String(e)}`));
    }

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
