import { Process, Processor, OnQueueFailed }  from '@nestjs/bull';
import { Injectable, Logger }     from '@nestjs/common';
import { Job, Queue }             from 'bull';
import { InjectQueue }            from '@nestjs/bull';
import { Cron }                   from '@nestjs/schedule';
import { InjectRepository }       from '@nestjs/typeorm';
import { Repository }             from 'typeorm';
import { InjectDataSource }       from '@nestjs/typeorm';
import { DataSource }             from 'typeorm';

import { PingService }        from './services/ping.service';
import { SnmpService }        from './services/snmp.service';
import { AlertasService }     from './services/alertas.service';
import { MonitoreoGateway }   from './gateways/monitoreo.gateway';
import { NodoDeviceService }  from './services/nodo-device.service';

import {
  Nodo, MedicionNodo, EstadoNodo, MetricaAlerta,
} from './entities/monitoreo.entity';

export const MONITOREO_QUEUE  = 'monitoreo';
export const JOB_PING_NODO    = 'ping-nodo';
export const JOB_SNMP_NODO    = 'snmp-nodo';
export const JOB_PING_BATCH   = 'ping-batch';
export const JOB_DASHBOARD    = 'broadcast-dashboard';
export const JOB_API_NODO     = 'api-nodo';        // RouterOS API polling (MikroTik)

// ─────────────────────────────────────────────────────────────
// Scheduler: encola los jobs en el momento correcto
// ─────────────────────────────────────────────────────────────
@Injectable()
export class MonitoreoScheduler {
  private readonly logger = new Logger(MonitoreoScheduler.name);

  constructor(
    @InjectQueue(MONITOREO_QUEUE) private readonly queue: Queue,
    @InjectRepository(Nodo) private readonly nodoRepo: Repository<Nodo>,
  ) {}

  // ── Ping a todos los nodos cada 60 segundos ──────────────
  // Nota: nodos con router_id son monitoreados por NetWatch desde el propio router
  @Cron('*/60 * * * * *', { timeZone: 'America/Lima', name: 'ping-ciclo' })
  async schedulePing(): Promise<void> {
    const nodos = await this.nodoRepo
      .createQueryBuilder('n')
      .where('n.activo = true')
      .andWhere('n.ping_habilitado = true')
      .andWhere('n.router_id IS NULL')
      .andWhere('n.deleted_at IS NULL')
      .getMany();

    if (!nodos.length) return;

    // Agrupar por empresa para procesar en lote
    const porEmpresa = new Map<string, Nodo[]>();
    for (const n of nodos) {
      if (!porEmpresa.has(n.empresaId)) porEmpresa.set(n.empresaId, []);
      porEmpresa.get(n.empresaId)!.push(n);
    }

    // Encolar un job de ping por empresa (procesamiento en lote más eficiente)
    for (const [empresaId, nodosEmpresa] of porEmpresa.entries()) {
      await this.queue.add(JOB_PING_BATCH, {
        empresaId,
        nodos: nodosEmpresa.map((n) => ({
          id:             n.id,
          ip:             n.ipMonitoreo,
          nombre:         n.nombre,
          tipo:           n.tipo,
          pingTimeoutMs:  n.pingTimeoutMs,
          pingReintentos: n.pingReintentos,
          estadoActual:   n.estado,
          alertasHabilitadas: n.alertasHabilitadas,
        })),
      }, {
        removeOnComplete: true,
        removeOnFail:     50,
        attempts:         1,  // Sin reintentos — el siguiente ciclo ya hará otro ping
      });
    }

    this.logger.debug(`Ping encolado: ${nodos.length} nodos en ${porEmpresa.size} empresas`);
  }

  // ── SNMP polling cada 5 minutos ──────────────────────────
  @Cron('0 */5 * * * *', { timeZone: 'America/Lima', name: 'snmp-ciclo' })
  async scheduleSnmp(): Promise<void> {
    const nodos = await this.nodoRepo.find({
      where: { activo: true, snmpHabilitado: true },
    });

    for (const nodo of nodos) {
      await this.queue.add(JOB_SNMP_NODO, {
        nodoId:     nodo.id,
        empresaId:  nodo.empresaId,
        nombre:     nodo.nombre,
        ip:         nodo.ipMonitoreo,
        community:  nodo.snmpCommunity,
        version:    nodo.snmpVersion,
        ifIndex:    nodo.snmpInterfaceIndex,
        alertasHabilitadas: nodo.alertasHabilitadas,
      }, {
        removeOnComplete: true,
        removeOnFail:     50,
        attempts:         2,
        backoff: { type: 'fixed', delay: 30_000 },
        delay: nodos.indexOf(nodo) * 500,  // Escalonar para no saturar la red
      });
    }
  }

  // ── RouterOS API polling cada 5 minutos (nodos MikroTik) ─
  @Cron('0 */5 * * * *', { timeZone: 'America/Lima', name: 'api-ciclo' })
  async scheduleApiNodos(): Promise<void> {
    const nodos = await this.nodoRepo
      .createQueryBuilder('n')
      .where('n.activo = true')
      .andWhere("n.metodo_conexion = 'api'")
      .andWhere('n.usuario IS NOT NULL')
      .andWhere('n.password_cifrado IS NOT NULL')
      .getMany();

    for (const nodo of nodos) {
      await this.queue.add(JOB_API_NODO, {
        nodoId:    nodo.id,
        empresaId: nodo.empresaId,
        nombre:    nodo.nombre,
      }, {
        removeOnComplete: true,
        removeOnFail:     50,
        delay: nodos.indexOf(nodo) * 800,
      });
    }
  }

  // ── Broadcast dashboard cada 30 segundos ─────────────────
  @Cron('*/30 * * * * *', { timeZone: 'America/Lima' })
  async scheduleDashboard(): Promise<void> {
    await this.queue.add(JOB_DASHBOARD, {}, {
      removeOnComplete: true,
      attempts: 1,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Processor: procesa los jobs de monitoreo
// ─────────────────────────────────────────────────────────────
@Processor(MONITOREO_QUEUE)
export class MonitoreoWorker {
  private readonly logger = new Logger(MonitoreoWorker.name);

  constructor(
    private readonly pingSvc:    PingService,
    private readonly snmpSvc:    SnmpService,
    private readonly alertasSvc: AlertasService,
    private readonly gateway:    MonitoreoGateway,
    private readonly deviceSvc:  NodoDeviceService,
    @InjectRepository(Nodo)         private readonly nodoRepo: Repository<Nodo>,
    @InjectRepository(MedicionNodo) private readonly medicionRepo: Repository<MedicionNodo>,
    @InjectDataSource()             private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // JOB: PING EN LOTE (procesamiento de todos los nodos de una empresa)
  // ────────────────────────────────────────────────────────────
  @Process(JOB_PING_BATCH)
  async processPingBatch(job: Job<{
    empresaId: string;
    nodos: Array<{
      id: string; ip: string; nombre: string; tipo: string;
      pingTimeoutMs: number; pingReintentos: number;
      estadoActual: EstadoNodo; alertasHabilitadas: boolean;
    }>;
  }>) {
    const { empresaId, nodos } = job.data;
    const inicio = Date.now();

    // Hacer ping en paralelo a todos los nodos de la empresa
    const ips = nodos.map((n) => n.ip);
    const resultados = await this.pingSvc.pingBulk(ips, 3, 3000, 15);

    // Procesar resultados
    const updates: Promise<void>[] = [];

    for (const nodo of nodos) {
      const ping = resultados.get(nodo.ip);
      if (!ping) continue;

      updates.push(this.procesarResultadoPing(nodo, ping, empresaId));
    }

    await Promise.allSettled(updates);

    const duracion = Date.now() - inicio;
    this.logger.debug(
      `Ping batch ${empresaId}: ${nodos.length} nodos en ${duracion}ms`,
    );
  }

  // ── Procesar resultado de ping de un nodo ────────────────
  private async procesarResultadoPing(
    nodo: {
      id: string; ip: string; nombre: string; tipo: string;
      estadoActual: EstadoNodo; alertasHabilitadas: boolean;
    },
    ping: { alive: boolean; latencyMs: number | null; lossPerct: number; avg: number | null },
    empresaId: string,
  ): Promise<void> {
    const ahora      = new Date();
    const nuevoEstado = ping.alive ? EstadoNodo.ONLINE : EstadoNodo.OFFLINE;
    const estadoCambio = nodo.estadoActual !== nuevoEstado;

    // ── 1. Actualizar nodo en BD ─────────────────────────────
    const updateData: Partial<Nodo> = {
      estado:     nuevoEstado,
      ultimoPing: ahora,
      latenciaMs: ping.latencyMs ?? undefined,
      perdidaPct: ping.lossPerct,
    };

    if (estadoCambio) {
      updateData.estadoDesde = ahora;
    }

    await this.nodoRepo.update(nodo.id, updateData);

    // ── 2. Guardar medición histórica ────────────────────────
    await this.medicionRepo.save(
      this.medicionRepo.create({
        nodoId:     nodo.id,
        empresaId,
        timestamp:  ahora,
        latenciaMs: ping.latencyMs ?? undefined,
        perdidaPct: ping.lossPerct,
        online:     ping.alive,
      }),
    );

    // ── 3. Detectar cambios de estado y alertar ─────────────
    if (estadoCambio && nodo.alertasHabilitadas) {
      if (nuevoEstado === EstadoNodo.OFFLINE) {
        this.logger.warn(`🔴 NODO OFFLINE: ${nodo.nombre} (${nodo.ip})`);
        await this.alertasSvc.alertarNodoOffline(nodo.id, empresaId, nodo.nombre);
      } else {
        this.logger.log(`🟢 NODO ONLINE: ${nodo.nombre} (${nodo.ip})`);
        await this.alertasSvc.alertarNodoOnline(nodo.id, empresaId, nodo.nombre);
      }
    }

    // ── 4. Evaluar umbrales de latencia y pérdida ────────────
    if (nodo.alertasHabilitadas && ping.alive) {
      if (ping.avg !== null && ping.avg > 0) {
        await this.alertasSvc.evaluar({
          nodoId:     nodo.id,
          empresaId,
          nodoNombre: nodo.nombre,
          metrica:    MetricaAlerta.PING_LATENCIA,
          valorActual: ping.avg,
        });
      }

      if (ping.lossPerct > 0) {
        await this.alertasSvc.evaluar({
          nodoId:     nodo.id,
          empresaId,
          nodoNombre: nodo.nombre,
          metrica:    MetricaAlerta.PING_PERDIDA,
          valorActual: ping.lossPerct,
        });
      }
    }

    // ── 5. Broadcast WebSocket en tiempo real ────────────────
    this.gateway.broadcastMedicion(empresaId, {
      nodoId:     nodo.id,
      nodoNombre: nodo.nombre,
      estado:     nuevoEstado,
      latenciaMs: ping.latencyMs,
      perdidaPct: ping.lossPerct,
      timestamp:  ahora.toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // JOB: SNMP POLLING DE UN NODO
  // ────────────────────────────────────────────────────────────
  @Process(JOB_SNMP_NODO)
  async processSnmpNodo(job: Job<{
    nodoId:    string;
    empresaId: string;
    nombre:    string;
    ip:        string;
    community: string;
    version:   number;
    ifIndex:   number;
    alertasHabilitadas: boolean;
  }>) {
    const { nodoId, empresaId, nombre, ip, community, version, ifIndex, alertasHabilitadas } = job.data;

    try {
      // Obtener métricas del sistema y tráfico en paralelo
      const [metricas, trafico] = await Promise.all([
        this.snmpSvc.getSystemInfo(ip, community, version, true),
        ifIndex
          ? Promise.resolve(null) // trafico SNMP pendiente
          : Promise.resolve(null),
      ]);

      const ahora = new Date();

      // Actualizar nodo en BD con métricas SNMP
      const updateData: Partial<Nodo> = {};
      if (metricas.cpuPct     !== undefined) updateData.cpuUsoPct     = metricas.cpuPct;
      if (metricas.memoriaPct !== undefined) updateData.memoriaUsoPct = metricas.memoriaPct;
      if (metricas.temperatura !== undefined) updateData.temperaturaC = metricas.temperatura;
      if (trafico) {
        updateData.traficoRxBps = trafico.rxBps;
        updateData.traficoTxBps = trafico.txBps;
      }

      await this.nodoRepo.update(nodoId, updateData);

      // Guardar en mediciones históricas
      await this.medicionRepo.update(
        // Actualizar la medición más reciente del nodo (del último ping)
        { nodoId },
        {
          cpuPct:      metricas.cpuPct,
          memoriaPct:  metricas.memoriaPct,
          temperaturaC: metricas.temperatura,
          traficoRxBps: trafico?.rxBps ? Number(trafico.rxBps) : undefined,
          traficoTxBps: trafico?.txBps ? Number(trafico.txBps) : undefined,
        },
      );

      // Evaluar umbrales de alertas
      if (alertasHabilitadas) {
        const metricsAEvaluar: Array<{ metrica: MetricaAlerta; valor: number | undefined }> = [
          { metrica: MetricaAlerta.CPU,          valor: metricas.cpuPct },
          { metrica: MetricaAlerta.MEMORIA,       valor: metricas.memoriaPct },
          { metrica: MetricaAlerta.TEMPERATURA,   valor: metricas.temperatura },
          { metrica: MetricaAlerta.TRAFICO_BAJADA, valor: trafico?.rxBps },
          { metrica: MetricaAlerta.TRAFICO_SUBIDA, valor: trafico?.txBps },
        ];

        for (const { metrica, valor } of metricsAEvaluar) {
          if (valor !== undefined && valor !== null) {
            await this.alertasSvc.evaluar({ nodoId, empresaId, nodoNombre: nombre, metrica, valorActual: valor });
          }
        }
      }

      // Broadcast de métricas SNMP al WebSocket
      this.gateway.broadcastMedicion(empresaId, {
        nodoId,
        nodoNombre:     nombre,
        estado:         EstadoNodo.ONLINE,
        latenciaMs:     null,
        perdidaPct:     0,
        cpuPct:         metricas.cpuPct,
        memoriaPct:     metricas.memoriaPct,
        traficoRxBps:   trafico?.rxBps,
        traficoTxBps:   trafico?.txBps,
        temperatura:    metricas.temperatura,
        timestamp:      ahora.toISOString(),
      });

      this.logger.debug(
        `SNMP ${nombre} (${ip}): CPU=${metricas.cpuPct}% | ` +
        `MEM=${metricas.memoriaPct}% | ` +
        `RX=${trafico ? (trafico.rxBps / 1e6).toFixed(2) + 'Mbps' : 'N/A'}`,
      );

    } catch (err) {
      this.logger.warn(`SNMP ${nombre} (${ip}): ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // JOB: BROADCAST DEL DASHBOARD COMPLETO
  // ────────────────────────────────────────────────────────────
  @Process(JOB_DASHBOARD)
  async processDashboard(_job: Job) {
    try {
      // Obtener resumen de todos los nodos por empresa
      const resumen = await this.ds.query(`
        SELECT
          n.empresa_id,
          COUNT(*) FILTER (WHERE n.estado = 'online')  AS online,
          COUNT(*) FILTER (WHERE n.estado = 'offline') AS offline,
          COUNT(*) FILTER (WHERE n.estado = 'degradado') AS degradado,
          COUNT(*)                                      AS total,
          AVG(n.latencia_ms) FILTER (WHERE n.estado = 'online' AND n.latencia_ms IS NOT NULL) AS latencia_avg,
          SUM(n.trafico_rx_bps) AS total_rx,
          SUM(n.trafico_tx_bps) AS total_tx,
          SUM(n.sesiones_pppoe) AS total_sesiones
        FROM nodos n
        WHERE n.activo = true AND n.deleted_at IS NULL
        GROUP BY n.empresa_id
      `);

      // Broadcast por empresa
      for (const row of resumen) {
        this.gateway.broadcastDashboard(row.empresa_id, {
          online:       parseInt(row.online  || '0', 10),
          offline:      parseInt(row.offline || '0', 10),
          degradado:    parseInt(row.degradado || '0', 10),
          total:        parseInt(row.total   || '0', 10),
          latenciaAvg:  parseFloat(row.latencia_avg || '0'),
          totalRxBps:   parseInt(row.total_rx || '0', 10),
          totalTxBps:   parseInt(row.total_tx || '0', 10),
          totalSesiones: parseInt(row.total_sesiones || '0', 10),
          timestamp:    new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.error(`Dashboard broadcast: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // JOB: ROUTEROS API POLLING (MikroTik — CPU, mem, sesiones)
  // ────────────────────────────────────────────────────────────
  @Process(JOB_API_NODO)
  async processApiNodo(job: Job<{ nodoId: string; empresaId: string; nombre: string }>) {
    const { nodoId, empresaId, nombre } = job.data;

    const nodo = await this.nodoRepo.findOne({ where: { id: nodoId } });
    if (!nodo) return;

    const medicion = await this.deviceSvc.getMedicionMikrotik(nodo);
    if (!medicion) return;

    const ahora = new Date();

    // Actualizar métricas en el nodo
    const updateData: Partial<Nodo> = {};
    if (medicion.cpuPct        !== undefined) updateData.cpuUsoPct     = medicion.cpuPct;
    if (medicion.memoriaPct    !== undefined) updateData.memoriaUsoPct = medicion.memoriaPct;
    if (medicion.temperatura   !== undefined) updateData.temperaturaC  = medicion.temperatura;
    if (medicion.sesionesPppoe !== undefined) updateData.sesionesPppoe = medicion.sesionesPppoe;
    await this.nodoRepo.update(nodoId, updateData);

    // Evaluar alertas de CPU y memoria
    const metricsAEvaluar = [
      { metrica: MetricaAlerta.CPU,         valor: medicion.cpuPct },
      { metrica: MetricaAlerta.MEMORIA,     valor: medicion.memoriaPct },
      { metrica: MetricaAlerta.TEMPERATURA, valor: medicion.temperatura },
    ];
    for (const { metrica, valor } of metricsAEvaluar) {
      if (valor !== undefined && nodo.alertasHabilitadas) {
        await this.alertasSvc.evaluar({ nodoId, empresaId, nodoNombre: nombre, metrica, valorActual: valor });
      }
    }

    // Broadcast WebSocket con métricas en tiempo real
    this.gateway.broadcastMedicion(empresaId, {
      nodoId,
      nodoNombre:    nombre,
      estado:        nodo.estado,
      latenciaMs:    nodo.latenciaMs,
      perdidaPct:    nodo.perdidaPct,
      cpuPct:        medicion.cpuPct,
      memoriaPct:    medicion.memoriaPct,
      temperatura:   medicion.temperatura,
      sesionesPppoe: medicion.sesionesPppoe,
      timestamp:     ahora.toISOString(),
    });

    this.logger.debug(
      `API ${nombre}: CPU=${medicion.cpuPct}% | MEM=${medicion.memoriaPct}% | PPPoE=${medicion.sesionesPppoe}`,
    );
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.name} #${job.id} falló: ${error.message}`);
  }
}
