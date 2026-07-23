import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 }     from '@nestjs/event-emitter';

import { OltOnuInventario }  from '../entities/olt-onu-inventario.entity';
import { OltDispositivo }    from '../entities/olt-dispositivo.entity';
import { OltBaseline }       from '../entities/olt-baseline.entity';
import { OltProveedorConfig } from '../entities/olt-proveedor-config.entity';
import { OltBoard }          from '../entities/olt-board.entity';
import { OltLineProfile }    from '../entities/olt-line-profile.entity';
import { OltServiceProfile } from '../entities/olt-service-profile.entity';
import { OltSyncJob, SyncJobEstado } from '../entities/olt-sync-job.entity';
import { OltVlan }           from '../entities/olt-vlan.entity';
import { OltTrafficTable }   from '../entities/olt-traffic-table.entity';
import { OltAutomationClient } from '../olt-automation.client';
import { ModuleHealthService } from '../../../common/services/module-health.service';
import { OltServicePortPoolService } from './olt-service-port-pool.service';
import { OltOnuIdPoolService }       from './olt-onu-id-pool.service';
import { OltConnService }            from './olt-conn.service';

// ─── Eventos WebSocket (emitidos por EventEmitter2, escuchados por OltGateway) ──
export const OLT_SYNC_PROGRESS  = 'olt.sync.progress';
export const OLT_SYNC_COMPLETED = 'olt.sync.completed';
export const OLT_SYNC_ERROR     = 'olt.sync.error';

export interface OltSyncProgressPayload {
  oltId:    string;
  jobId:    string;
  progreso: number;
  etapa:    string;
}

export interface OltSyncResultPayload {
  oltId:     string;
  jobId:     string;
  resultado: Record<string, unknown>;
}

export interface OltSyncErrorPayload {
  oltId:  string;
  jobId:  string;
  error:  string;
}

// ─────────────────────────────────────────────────────────────
// OltSyncService — Sincronización asíncrona OLT → ERP
//
// Llama a Python (wizardTopologia) y persiste boards, vlans,
// line_profiles, service_profiles y traffic_tables con upserts
// idempotentes. Emite eventos EventEmitter2 que OltGateway
// reenvía por WebSocket a la sala olt:{id}.
//
// Peor caso:
// - SSH timeout a mitad del sync → el job queda en 'failed', el
//   frontend recibe olt.sync.error, puede reintentar.
// - La OLT no tiene proveedor SSH → job falla inmediatamente.
// - Sync concurrente del mismo OLT → el segundo start() detecta
//   un job 'running' y retorna el jobId existente sin duplicar.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltSyncService implements OnModuleInit {
  private readonly logger = new Logger(OltSyncService.name);

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(OltProveedorConfig)
    private readonly provRepo: Repository<OltProveedorConfig>,

    @InjectRepository(OltBoard)
    private readonly boardRepo: Repository<OltBoard>,

    @InjectRepository(OltLineProfile)
    private readonly lineProfileRepo: Repository<OltLineProfile>,

    @InjectRepository(OltServiceProfile)
    private readonly srvProfileRepo: Repository<OltServiceProfile>,

    @InjectRepository(OltSyncJob)
    private readonly syncJobRepo: Repository<OltSyncJob>,

    @InjectRepository(OltVlan)
    private readonly vlanRepo: Repository<OltVlan>,

    @InjectRepository(OltTrafficTable)
    private readonly trafficRepo: Repository<OltTrafficTable>,

    @InjectRepository(OltOnuInventario)
    private readonly inventarioRepo: Repository<OltOnuInventario>,

    @InjectRepository(OltBaseline)
    private readonly baselineRepo: Repository<OltBaseline>,

    @InjectDataSource()
    private readonly ds: DataSource,

    private readonly automation:   OltAutomationClient,
    private readonly moduleHealth: ModuleHealthService,
    private readonly events:       EventEmitter2,
    private readonly servicePortPool: OltServicePortPoolService,
    private readonly onuIdPool:       OltOnuIdPoolService,
    private readonly connService:     OltConnService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const health = await this.automation.health();
      if (health && (health as any).status === 'ok') {
        this.moduleHealth.registrar('olt-sync', 'ok');
      } else {
        this.moduleHealth.registrar('olt-sync', 'degraded', 'Python automation no reporta ok');
      }
    } catch {
      this.moduleHealth.registrar('olt-sync', 'degraded', 'Python automation no disponible');
    }
  }

  // ── API pública ───────────────────────────────────────────────

  /** Inicia un job de sincronización. Si ya hay uno 'running', retorna su id. */
  async iniciarSync(oltId: string, empresaId: string): Promise<{ jobId: string }> {
    const running = await this.syncJobRepo.findOne({
      where: { oltId, empresaId, estado: 'running' as SyncJobEstado },
    });
    if (running) return { jobId: running.id };

    const job = this.syncJobRepo.create({ oltId, empresaId, estado: 'running', progreso: 0 });
    await this.syncJobRepo.save(job);

    // Lanzar en background — no awaiteamos para responder rápido al cliente
    this._ejecutarSync(job.id, oltId, empresaId).catch(e => {
      this.logger.error(`[sync:${job.id}] Error no capturado: ${e?.message}`);
    });

    return { jobId: job.id };
  }

  /**
   * Incremento 5 — convergencia real: aplica los servidores NTP deseados
   * en la OLT (agrega/quita el diff) y persiste tanto el deseado como el
   * estado real resultante. Nunca asume éxito — el resultado devuelto es
   * lo que la OLT reportó DESPUÉS del cambio, releído por el driver.
   */
  async aplicarNtpServers(
    oltId: string, empresaId: string, servers: string[],
  ): Promise<{ aplicado: boolean; ntpServers: OltDispositivo['ntpServers']; error?: string }> {
    const olt  = await this.oltRepo.findOneOrFail({ where: { id: oltId, empresaId } });
    const conn = await this._buildConn(oltId, empresaId, olt);

    const res = await this.automation.applyNtpServers({ connection: conn, servers });

    await this.oltRepo.update(oltId, { ntpServersDeseados: servers });

    if (!res.success) {
      return { aplicado: false, ntpServers: olt.ntpServers, error: res.error };
    }

    const ntpServers = res.ntp_servers.map(s => ({
      source: s.source, stratum: s.stratum, reach: s.reach, status: s.status,
    }));
    await this.oltRepo.update(oltId, { ntpServers, configSnapshotAt: new Date() });

    return { aplicado: true, ntpServers };
  }

  /** Estado actual del último job para un OLT. */
  async estadoSync(oltId: string, empresaId: string): Promise<OltSyncJob | null> {
    return this.syncJobRepo.findOne({
      where: { oltId, empresaId },
      order: { iniciadoEn: 'DESC' },
    });
  }

  /**
   * Inventario observado (read-model) de la OLT + resumen de drift del último sync.
   * La UI lee de aquí (instantáneo) en vez de SSH en vivo.
   */
  async inventario(oltId: string, empresaId: string): Promise<{
    onus:  OltOnuInventario[];
    drift: Record<string, unknown> | null;
    snapshotAt: Date | null;
  }> {
    const onus = await this.inventarioRepo.find({
      where: { oltId, empresaId },
      order: { slot: 'ASC', port: 'ASC', onuId: 'ASC' },
    });
    const ultimoJob = await this.syncJobRepo.findOne({
      where: { oltId, empresaId, estado: 'completed' as SyncJobEstado },
      order: { completadoEn: 'DESC' },
    });
    return {
      onus,
      drift: (ultimoJob?.resultado as Record<string, unknown>) ?? null,
      snapshotAt: onus[0]?.snapshotAt ?? null,
    };
  }

  /**
   * Inventario GLOBAL de ONUs (todas las OLTs de la empresa) desde el read-model.
   * Una sola query, sin SSH. Incluye el nombre de la OLT. La UI filtra en cliente.
   */
  async inventarioGlobal(empresaId: string): Promise<Array<Record<string, unknown>>> {
    return this.ds.query(
      `SELECT i.olt_id       AS "oltId",
              o.nombre        AS "oltNombre",
              i.slot, i.port,
              i.onu_id        AS "onuId",
              i.sn,
              i.estado_operativo AS "estadoOperativo",
              i.rx_power_dbm  AS "rxPowerDbm",
              i.sin_contrato  AS "sinContrato",
              i.contrato_id   AS "contratoId",
              i.numero_contrato AS "numeroContrato",
              i.cliente,
              i.origen,
              i.snapshot_at   AS "snapshotAt"
         FROM olt_onu_inventario i
         JOIN olt_dispositivos o ON o.id = i.olt_id
        WHERE i.empresa_id = $1
        ORDER BY o.nombre ASC, i.slot ASC, i.port ASC, i.onu_id ASC NULLS LAST`,
      [empresaId],
    );
  }

  /**
   * Drift ERP↔OLT calculado 100% del read-model (sin SSH): compara el inventario
   * observado (olt_onu_inventario) contra el estado deseado (contratos + registros).
   */
  async drift(oltId: string, empresaId: string): Promise<{
    enErpNoEnOlt:     Array<{ contratoId: string; sn: string; slot: number; port: number; numeroContrato: string | null; cliente: string | null }>;
    sinContrato:      Array<{ sn: string; slot: number; port: number; onuId: number | null; estadoOperativo: string; rxPowerDbm: number | null }>;
    noAprovisionadas: Array<{ sn: string; slot: number; port: number }>;
    estadoDivergente: Array<{ contratoId: string; sn: string; onuEstado: string; contratoEstado: string; accionSugerida: 'SUSPENDER_ONU' | 'REACTIVAR_ONU'; numeroContrato: string | null; cliente: string | null }>;
    snapshotAt:       Date | null;
  }> {
    const norm = (sn?: string | null): string =>
      (sn ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8);

    const inv = await this.inventarioRepo.find({ where: { oltId, empresaId } });
    const observados = new Set(inv.map(i => norm(i.sn)));

    const sinContrato = inv
      .filter(i => i.origen === 'configurada' && i.sinContrato)
      .map(i => ({ sn: i.sn, slot: i.slot, port: i.port, onuId: i.onuId, estadoOperativo: i.estadoOperativo, rxPowerDbm: i.rxPowerDbm }));

    const noAprovisionadas = inv
      .filter(i => i.origen === 'autofind')
      .map(i => ({ sn: i.sn, slot: i.slot, port: i.port }));

    // Estado deseado: registros ACTIVO en el ERP que NO se observaron en la OLT.
    const registros: Array<{ contrato_id: string; sn: string; slot: number; port: number; numero_contrato: string | null; cliente: string | null }> =
      await this.ds.query(
        `SELECT r.contrato_id, r.sn, r.slot, r.port, c.numero_contrato,
                COALESCE(cl.nombre_completo, TRIM(CONCAT(cl.nombres,' ',cl.apellido_paterno,' ',cl.apellido_materno))) AS cliente
           FROM ftth_onu_registro r
           JOIN contratos c ON c.id = r.contrato_id
           LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE r.deleted_at IS NULL AND r.olt_id = $1 AND r.empresa_id = $2 AND r.estado = 'activo'`,
        [oltId, empresaId],
      );
    const enErpNoEnOlt = registros
      .filter(r => !observados.has(norm(r.sn)))
      .map(r => ({ contratoId: r.contrato_id, sn: r.sn, slot: r.slot, port: r.port, numeroContrato: r.numero_contrato, cliente: r.cliente }));

    // Divergencia de estado contrato↔ONU. Sin botones manuales de suspensión
    // (retirados 2026-07-23), cualquier cruce restante es un comando de outbox
    // que no llegó o un residuo histórico — se muestra y se repara re-encolando.
    // Contrato CON servicio: activo|moroso. SIN servicio: suspendido|cortado.
    const cruzados: Array<{ contrato_id: string; sn: string; onu_estado: string; contrato_estado: string; numero_contrato: string | null; cliente: string | null }> =
      await this.ds.query(
        `SELECT r.contrato_id, r.sn, r.estado AS onu_estado, c.estado AS contrato_estado, c.numero_contrato,
                COALESCE(cl.nombre_completo, TRIM(CONCAT(cl.nombres,' ',cl.apellido_paterno,' ',cl.apellido_materno))) AS cliente
           FROM ftth_onu_registro r
           JOIN contratos c ON c.id = r.contrato_id
           LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE r.deleted_at IS NULL AND r.olt_id = $1 AND r.empresa_id = $2
            AND ((r.estado = 'suspendido' AND c.estado IN ('activo','moroso'))
              OR (r.estado = 'activo'     AND c.estado IN ('suspendido','cortado')))`,
        [oltId, empresaId],
      );
    const estadoDivergente = cruzados.map(r => ({
      contratoId:     r.contrato_id,
      sn:             r.sn,
      onuEstado:      r.onu_estado,
      contratoEstado: r.contrato_estado,
      accionSugerida: (r.onu_estado === 'suspendido' ? 'REACTIVAR_ONU' : 'SUSPENDER_ONU') as 'SUSPENDER_ONU' | 'REACTIVAR_ONU',
      numeroContrato: r.numero_contrato,
      cliente:        r.cliente,
    }));

    return { enErpNoEnOlt, sinContrato, noAprovisionadas, estadoDivergente, snapshotAt: inv[0]?.snapshotAt ?? null };
  }

  // ── Ejecución interna ─────────────────────────────────────────

  private async _ejecutarSync(jobId: string, oltId: string, empresaId: string): Promise<void> {
    const emit = (progreso: number, etapa: string) => {
      this.events.emit(OLT_SYNC_PROGRESS, { oltId, jobId, progreso, etapa } satisfies OltSyncProgressPayload);
      this.syncJobRepo.update(jobId, { progreso });
    };

    try {
      // 1. Obtener OLT y conexión SSH
      emit(5, 'Obteniendo credenciales…');
      const olt  = await this.oltRepo.findOneOrFail({ where: { id: oltId, empresaId } });
      const conn = await this._buildConn(oltId, empresaId, olt);

      // 2. Llamar a Python: topología completa
      emit(15, 'Conectando a la OLT…');
      const topo = await this.automation.wizardTopologia({ connection: conn });

      if (!topo.success) {
        throw new Error(topo.error ?? 'La OLT no devolvió topología');
      }

      // 2b. Persistir modelo/firmware reales detectados por 'display version'
      // (el driver los incluye en la topología). Autodetección continua: si la
      // OLT se actualiza de firmware, el ERP lo ve en el siguiente sync y las
      // reglas de compatibilidad se reevalúan solas.
      const cambios: Partial<OltDispositivo> = {};
      if (topo.model && !topo.model.includes('MA5x00')) cambios.modelo = topo.model;
      if (topo.firmware_version) cambios.firmware = topo.firmware_version;
      if (Object.keys(cambios).length) await this.oltRepo.update(oltId, cambios);

      // 3. Persistir boards
      emit(35, 'Guardando tarjetas…');
      await this._upsertBoards(oltId, empresaId, topo.boards ?? []);

      // 4. Persistir VLANs
      emit(50, 'Guardando VLANs…');
      await this._upsertVlans(oltId, empresaId, topo.vlans ?? []);

      // 5. Persistir line profiles
      emit(65, 'Guardando line-profiles…');
      await this._upsertLineProfiles(oltId, empresaId, topo.line_profiles ?? []);

      // 6. Persistir service profiles
      emit(78, 'Guardando service-profiles…');
      await this._upsertServiceProfiles(oltId, empresaId, topo.service_profiles ?? []);

      // 7. Persistir traffic tables
      emit(85, 'Guardando traffic-tables…');
      await this._upsertTrafficTables(oltId, empresaId, topo.traffic_tables ?? []);

      // 8. Inventario de ONUs (estado observado) + drift contra el ERP
      emit(90, 'Inventariando ONUs…');
      const drift = await this._snapshotOnus(
        oltId, empresaId, conn, (topo.boards ?? []).map(b => b.slot),
      );

      // 8b. Reconciliación automática de pools — Incremento 7. Mientras
      // SmartOLT coexista, cada ONU que aprovisione fuera del ERP ocupa un
      // service-port y un ONU-ID que el pool creería libre. Antes esto era un
      // botón manual; ahora corre en cada sync. Best-effort: solo marca
      // libre→ocupado (nunca libera ni pisa contrato_id del ERP), y un fallo
      // aquí no tumba el sync.
      emit(92, 'Reconciliando pools contra la OLT…');
      const pools = await this._reconciliarPools(oltId, empresaId);

      // 8c. Config real SNMP/NTP — best-effort, nunca bloquea el sync.
      // No todas las marcas la implementan (get_snmp_ntp_config retorna
      // ok=False para las que no) y una OLT lenta no debe tumbar el sync
      // completo por esto.
      emit(95, 'Leyendo config SNMP/NTP…');
      await this._snapshotSnmpNtp(oltId, empresaId, conn);

      // 8d. Observed state del uplink (Incremento 9b) — best-effort. Solo si
      // el baseline asignado declara uplinkPort; sin baseline no hay qué leer.
      emit(97, 'Leyendo VLANs del uplink…');
      await this._snapshotUplink(olt, conn);

      // 9. Completar job
      const resultado: Record<string, unknown> = {
        boards:           (topo.boards ?? []).length,
        vlans:            (topo.vlans  ?? []).length,
        lineProfiles:     (topo.line_profiles    ?? []).length,
        serviceProfiles:  (topo.service_profiles ?? []).length,
        trafficTables:    (topo.traffic_tables   ?? []).length,
        firmware:         topo.firmware_version ?? null,
        modelo:           topo.model ?? null,
        onusInventario:      drift.total,
        onusSinContrato:     drift.sinContrato,
        onusNoAprovisionadas: drift.noAprovisionadas,
        onusEnErpNoEnOlt:    drift.enErpNoEnOlt,
        poolsReconciliados:  pools,
      };

      await this.syncJobRepo.update(jobId, {
        estado: 'completed', progreso: 100, resultado, completadoEn: new Date(),
      });

      this.events.emit(OLT_SYNC_COMPLETED, { oltId, jobId, resultado } satisfies OltSyncResultPayload);
      this.logger.log(`[sync:${jobId}] OLT ${olt.nombre} sincronizada OK`);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[sync:${jobId}] Error: ${msg}`);
      await this.syncJobRepo.update(jobId, {
        estado: 'failed', error: msg, completadoEn: new Date(),
      });
      this.events.emit(OLT_SYNC_ERROR, { oltId, jobId, error: msg } satisfies OltSyncErrorPayload);
    }
  }

  // ── Upserts idempotentes (TypeORM repo.upsert — ON CONFLICT DO UPDATE) ──

  private async _upsertBoards(
    oltId: string, empresaId: string,
    boards: { slot: number; board_type: string; state: string; onu_count: number }[],
  ): Promise<void> {
    if (!boards.length) return;
    await this.boardRepo.upsert(
      boards.map(b => ({ oltId, empresaId, slot: b.slot, boardType: b.board_type, estado: b.state, onuCount: b.onu_count })),
      { conflictPaths: ['oltId', 'slot'], skipUpdateIfNoValuesChanged: true },
    );
  }

  // Lo descubierto en la OLT se inserta con origen='olt' (externo). En
  // conflicto: tipo/serv_ports (observed state) se refrescan siempre; el
  // nombre solo para VLANs externas — el ERP es dueño de los nombres de las
  // suyas (ERP-INTERNET, ERP-TR069…) y 'display vlan all' no trae nombres.
  private async _upsertVlans(
    oltId: string, empresaId: string,
    vlans: { vlan_id: number; name: string; vlan_type?: string | null; serv_ports?: number | null }[],
  ): Promise<void> {
    if (!vlans.length) return;
    await this.ds.query(
      `INSERT INTO olt_vlans
         (id, olt_id, empresa_id, vlan_id, nombre, tipo, serv_ports, origen, estado, created_at, updated_at)
       SELECT gen_random_uuid(), $1, $2, t.vid, t.name, t.tipo, t.sp, 'olt', 'active', NOW(), NOW()
       FROM   unnest($3::int[], $4::text[], $5::text[], $6::int[]) AS t(vid, name, tipo, sp)
       ON CONFLICT (olt_id, vlan_id) DO UPDATE
         SET tipo       = COALESCE(EXCLUDED.tipo, olt_vlans.tipo),
             serv_ports = COALESCE(EXCLUDED.serv_ports, olt_vlans.serv_ports),
             nombre     = CASE WHEN olt_vlans.origen = 'erp' THEN olt_vlans.nombre ELSE EXCLUDED.nombre END,
             updated_at = NOW()`,
      [
        oltId, empresaId,
        vlans.map(v => v.vlan_id),
        vlans.map(v => v.name),
        vlans.map(v => v.vlan_type ?? null),
        vlans.map(v => v.serv_ports ?? null),
      ],
    );
  }

  private async _upsertLineProfiles(
    oltId: string, empresaId: string,
    profiles: { profile_id: number; name: string }[],
  ): Promise<void> {
    if (!profiles.length) return;
    await this.lineProfileRepo.upsert(
      profiles.map(p => ({ oltId, empresaId, profileId: p.profile_id, nombre: p.name })),
      { conflictPaths: ['oltId', 'profileId'], skipUpdateIfNoValuesChanged: true },
    );
  }

  private async _upsertServiceProfiles(
    oltId: string, empresaId: string,
    profiles: { profile_id: number; name: string }[],
  ): Promise<void> {
    if (!profiles.length) return;
    await this.srvProfileRepo.upsert(
      profiles.map(p => ({ oltId, empresaId, profileId: p.profile_id, nombre: p.name })),
      { conflictPaths: ['oltId', 'profileId'], skipUpdateIfNoValuesChanged: true },
    );
  }

  // 'display traffic table ip from-index 0' NO trae nombres — el driver
  // genera sintéticos. El ERP es dueño de los nombres de sus tablas
  // (origen='erp': ERP-MGMT, ERP-100M…): jamás se pisan en el sync.
  // Regresión real 2026-07-16: el upsert anterior renombró las tablas del
  // estándar a 'traffic-table-N' y el plan quiso recrearlas todas.
  private async _upsertTrafficTables(
    oltId: string, empresaId: string,
    tables: { index: number; name: string; cir_kbps: number | null; pir_kbps: number | null; cbs_bytes?: number | null; pbs_bytes?: number | null }[],
  ): Promise<void> {
    if (!tables.length) return;
    await this.ds.query(
      `INSERT INTO olt_traffic_tables
         (id, olt_id, empresa_id, traffic_id, nombre, cir_kbps, pir_kbps, cbs_bytes, pbs_bytes, origen, estado, created_at, updated_at)
       SELECT gen_random_uuid(), $1, $2, t.idx, t.name, t.cir, t.pir, t.cbs, t.pbs, 'olt', 'active', NOW(), NOW()
       FROM   unnest($3::int[], $4::text[], $5::int[], $6::int[], $7::int[], $8::int[])
              AS t(idx, name, cir, pir, cbs, pbs)
       ON CONFLICT (olt_id, traffic_id) DO UPDATE
         SET cir_kbps   = EXCLUDED.cir_kbps,
             pir_kbps   = EXCLUDED.pir_kbps,
             cbs_bytes  = EXCLUDED.cbs_bytes,
             pbs_bytes  = EXCLUDED.pbs_bytes,
             nombre     = CASE WHEN olt_traffic_tables.origen = 'erp'
                               THEN olt_traffic_tables.nombre ELSE EXCLUDED.nombre END,
             updated_at = NOW()`,
      [
        oltId, empresaId,
        tables.map(t => t.index),
        tables.map(t => t.name),
        tables.map(t => t.cir_kbps),
        tables.map(t => t.pir_kbps),
        tables.map(t => t.cbs_bytes ?? null),
        tables.map(t => t.pbs_bytes ?? null),
      ],
    );
  }

  // ── Reconciliación de pools (Incremento 7) — best-effort ──────
  // Los service-ports se releen de la OLT (fuente real); los ONU-IDs se
  // reconcilian contra olt_onu_inventario, que _snapshotOnus acaba de poblar.
  private async _reconciliarPools(
    oltId: string, empresaId: string,
  ): Promise<{ servicePorts: number | null; onuIds: number | null; error?: string }> {
    const out: { servicePorts: number | null; onuIds: number | null; error?: string } =
      { servicePorts: null, onuIds: null };
    try {
      const sp = await this.servicePortPool.reconciliarConOlt(oltId, empresaId);
      out.servicePorts = sp.marcadosOcupados;
    } catch (e) {
      out.error = `service-ports: ${(e as Error).message}`;
      this.logger.warn(`_reconciliarPools service-ports | olt=${oltId}: ${(e as Error).message}`);
    }
    try {
      const oi = await this.onuIdPool.reconciliarTodosPuertos(oltId, empresaId);
      out.onuIds = oi.marcados;
    } catch (e) {
      out.error = [out.error, `onu-ids: ${(e as Error).message}`].filter(Boolean).join(' | ');
      this.logger.warn(`_reconciliarPools onu-ids | olt=${oltId}: ${(e as Error).message}`);
    }
    return out;
  }

  // ── Credenciales SSH ──────────────────────────────────────────

  // ── Config real SNMP/NTP — best-effort ─────────────────────────
  // Nunca lanza: un fallo aquí (marca sin soporte, timeout SSH) no debe
  // marcar el sync completo como 'failed'. Si falla, simplemente no
  // actualiza config_snapshot_at y el dato anterior (si existe) queda
  // como estaba — las reglas de compliance ya distinguen "sin datos" de
  // "no cumple".
  private async _snapshotSnmpNtp(
    oltId: string, empresaId: string,
    conn:  { ip: string; port: number; username: string; password: string; brand: string },
  ): Promise<void> {
    try {
      const res = await this.automation.configSnmpNtp({ connection: conn });
      if (!res.success) {
        this.logger.debug(`_snapshotSnmpNtp | olt=${oltId}: ${res.error ?? 'sin datos'}`);
        return;
      }
      await this.oltRepo.update(oltId, {
        snmpRealCommunities: res.snmp_communities.map(c => ({ name: c.name, access: c.access })),
        snmpRealVersions:    res.snmp_versions,
        ntpServers:          res.ntp_servers.map(s => ({
          source: s.source, stratum: s.stratum, reach: s.reach, status: s.status,
        })),
        configSnapshotAt:    new Date(),
      });
    } catch (e) {
      this.logger.warn(`_snapshotSnmpNtp | olt=${oltId}: ${(e as Error).message}`);
    }
  }

  // ── Observed state del uplink (9b) — best-effort, nunca tumba el sync ──
  private async _snapshotUplink(
    olt:  OltDispositivo,
    conn: { ip: string; port: number; username: string; password: string; brand: string },
  ): Promise<void> {
    try {
      if (!olt.baselineId) return;
      const baseline = await this.baselineRepo.findOne({ where: { id: olt.baselineId } });
      const portPath = baseline?.spec?.uplinkPort;
      if (!portPath) return;

      const res = await this.automation.uplinkVlans({ connection: conn, port_path: portPath });
      if (!res.success) {
        this.logger.debug(`_snapshotUplink | olt=${olt.id}: ${res.error ?? 'sin datos'}`);
        return;
      }
      await this.oltRepo.update(olt.id, {
        uplinkVlans: { ...(olt.uplinkVlans ?? {}), [portPath]: res.vlan_ids },
      });
      this.logger.log(`_snapshotUplink | olt=${olt.id} ${portPath} → [${res.vlan_ids.join(', ')}]`);
    } catch (e) {
      this.logger.warn(`_snapshotUplink | olt=${olt.id}: ${(e as Error).message}`);
    }
  }

  private async _buildConn(
    _oltId: string, _empresaId: string, olt: OltDispositivo,
  ): Promise<{ ip: string; port: number; username: string; password: string; brand: string }> {
    return this.connService.buildConn(olt);
  }

  // ── Inventario de ONUs (estado observado) + drift ─────────────
  // Recorre solo los puertos PON con ONUs (summary por slot), clasifica cada uno,
  // y persiste un snapshot completo en olt_onu_inventario (delete + insert por OLT).
  // Devuelve contadores de drift contra el estado deseado (contratos del ERP).
  private async _snapshotOnus(
    oltId:     string,
    empresaId: string,
    conn:      { ip: string; port: number; username: string; password: string; brand: string },
    slots:     number[],
  ): Promise<{ total: number; sinContrato: number; noAprovisionadas: number; enErpNoEnOlt: number }> {
    // Estado deseado: SN (sufijo 8 hex único) → contrato. La OLT reporta el SN crudo
    // (48575443994E1BA5) y la BD la forma de vendedor (HWTC994E1BA5): comparten sufijo.
    const norm = (sn?: string | null): string =>
      (sn ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8);

    const rows: Array<{ sn: string; contrato_id: string; numero_contrato: string; cliente: string }> =
      await this.ds.query(
        `SELECT r.sn, r.contrato_id, c.numero_contrato,
                COALESCE(cl.nombre_completo, TRIM(CONCAT(cl.nombres,' ',cl.apellido_paterno,' ',cl.apellido_materno))) AS cliente
           FROM ftth_onu_registro r
           JOIN contratos c ON c.id = r.contrato_id
           LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE r.deleted_at IS NULL AND r.olt_id = $1`,
        [oltId],
      );
    const contratoPorSn = new Map(rows.map(r => [norm(r.sn), r]));

    const snapshotAt   = new Date();
    const snObservados = new Set<string>();
    const filas        = new Map<string, Partial<OltOnuInventario>>(); // dedupe por slot:port:sn
    const slotsUnicos  = [...new Set(slots.length ? slots : [1])];

    for (const slot of slotsUnicos) {
      let puertos: number[] = [];
      try {
        const res = await this.automation.ponPorts({ connection: conn, slot });
        puertos = (res.ports ?? []).filter(p => p.onus_total > 0).map(p => p.port);
      } catch (e) {
        this.logger.warn(`_snapshotOnus ponPorts slot=${slot}: ${(e as Error).message}`);
        continue;
      }

      for (const port of puertos) {
        let clasif;
        try {
          clasif = await this.automation.clasificarOnus({ connection: conn, slot, port });
        } catch (e) {
          this.logger.warn(`_snapshotOnus classify ${slot}/${port}: ${(e as Error).message}`);
          continue;
        }
        if (!clasif.success) continue;

        for (const o of clasif.onus) {
          if (!o.sn) continue;
          const match = contratoPorSn.get(norm(o.sn));
          snObservados.add(norm(o.sn));
          filas.set(`${slot}:${port}:${o.sn}`, {
            empresaId, oltId, slot, port,
            onuId: o.onu_id, sn: o.sn,
            estadoOperativo: o.estado_operativo ?? 'offline',
            controlFlag: o.control_flag, runState: o.run_state,
            rxPowerDbm: o.rx_power_dbm,
            sinContrato: !match,
            contratoId: match?.contrato_id ?? null,
            numeroContrato: match?.numero_contrato ?? null,
            cliente: match?.cliente ?? null,
            origen: 'configurada',
            snapshotAt,
          });
        }
        for (const a of clasif.autofind) {
          if (!a.sn) continue;
          snObservados.add(norm(a.sn));
          const s = a.slot ?? slot, p = a.port ?? port;
          filas.set(`${s}:${p}:${a.sn}`, {
            empresaId, oltId, slot: s, port: p,
            onuId: null, sn: a.sn,
            estadoOperativo: 'no_aprovisionada',
            controlFlag: null, runState: null, rxPowerDbm: null,
            sinContrato: true, contratoId: null, numeroContrato: null,
            cliente: a.model ?? null,
            origen: 'autofind',
            snapshotAt,
          });
        }
      }
    }

    const inventario = [...filas.values()];

    // Persistir snapshot: reemplaza el inventario de esta OLT de forma atómica.
    await this.ds.transaction(async (tx) => {
      await tx.getRepository(OltOnuInventario).delete({ oltId });
      if (inventario.length) {
        await tx.getRepository(OltOnuInventario).insert(inventario);
      }
    });

    // Drift: ONUs con contrato activo en el ERP que NO se observaron en la OLT.
    let enErpNoEnOlt = 0;
    for (const snNorm of contratoPorSn.keys()) {
      if (!snObservados.has(snNorm)) enErpNoEnOlt++;
    }
    const sinContrato      = inventario.filter(i => i.origen === 'configurada' && i.sinContrato).length;
    const noAprovisionadas = inventario.filter(i => i.origen === 'autofind').length;

    this.logger.log(
      `_snapshotOnus | olt=${oltId} observadas=${inventario.length} sinContrato=${sinContrato} ` +
      `noAprov=${noAprovisionadas} enErpNoEnOlt=${enErpNoEnOlt}`,
    );

    return { total: inventario.length, sinContrato, noAprovisionadas, enErpNoEnOlt };
  }
}
