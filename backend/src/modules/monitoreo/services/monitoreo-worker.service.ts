// Ruta: /opt/datafast/backend/src/modules/monitoreo/services/monitoreo-worker.service.ts

import { Injectable, Logger }       from '@nestjs/common';
import { Cron, CronExpression }      from '@nestjs/schedule';
import { InjectRepository }          from '@nestjs/typeorm';
import { InjectDataSource }          from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import * as net from 'net';
import { exec }                      from 'child_process';
import { promisify }                 from 'util';

import { DispositivoMonitoreo }  from '../entities/dispositivo-monitoreo.entity';
import { MetricasMonitoreo }     from '../entities/metricas-monitoreo.entity';
import { AlertaSistema }         from '../entities/alerta-sistema.entity';
import { UmbralAlerta }          from '../entities/umbral-alerta.entity';
import {
  Fabricante, NivelAlerta, StatusAlerta,
  StatusDispositivo, TipoEquipo,
} from '../enums/monitoreo.enums';
import { RouterConnectionPool }  from '../../mikrotik/services/connection-pool.service';
import { MonitoreoGateway }      from '../monitoreo.gateway';

const execAsync = promisify(exec);


// ── Tipos internos ────────────────────────────────────────────────

interface ProbeResult {
  pingLatenciaMs:  number | null;
  pingLossPct:     number | null;
  cpuUsagePct:     number | null;
  memoryUsagePct:  number | null;
  trafficDownBps:  number | null;
  trafficUpBps:    number | null;
}

interface RouterCreds {
  id:              string;
  ip:              string;
  port:            number;
  user:            string;
  passwordCifrado: string;
  useSsl:          boolean;
  timeoutSec:      number;
  version:         string;
}

@Injectable()
export class MonitoreoWorkerService {
  private readonly logger = new Logger('MonitoreoWorker');

  // Guard: evita solapamiento de ciclos lentos
  private running = false;

  // C6: debounce OFFLINE — deviceId → fallos consecutivos
  private readonly failCount = new Map<string, number>();
  // A1: confirmaciones de umbral — `${deviceId}:${categoria}` → hits consecutivos
  private readonly thresholdHits = new Map<string, number>();
  // C3: último sondeo por dispositivo (epoch ms) — respeta intervaloChequeoSeg
  private readonly lastProbeAt = new Map<string, number>();

  constructor(
    @InjectRepository(DispositivoMonitoreo)
    private readonly dispoRepo: Repository<DispositivoMonitoreo>,

    @InjectRepository(MetricasMonitoreo)
    private readonly metricasRepo: Repository<MetricasMonitoreo>,

    @InjectRepository(AlertaSistema)
    private readonly alertaRepo: Repository<AlertaSistema>,

    @InjectRepository(UmbralAlerta)
    private readonly umbralRepo: Repository<UmbralAlerta>,

    @InjectDataSource()
    private readonly ds: DataSource,

    private readonly pool:    RouterConnectionPool,
    private readonly gateway: MonitoreoGateway,   // C1
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // CICLO PRINCIPAL — cada 60 segundos
  // ═══════════════════════════════════════════════════════════════
  @Cron(CronExpression.EVERY_MINUTE)
  async runCycle(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined &&
        process.env.NODE_APP_INSTANCE !== '0') {
      return;
    }

    if (this.running) {
      this.logger.warn('Ciclo previo aún en ejecución — saltando');
      return;
    }
    this.running = true;

    try {
      const dispositivos = await this.dispoRepo.find({
        where: { deletedAt: IsNull() },
      });

      if (dispositivos.length === 0) return;

      // C6: purgar entradas de dispositivos eliminados
      const activeIds = new Set(dispositivos.map(d => d.id));
      for (const key of this.failCount.keys()) {
        if (!activeIds.has(key)) this.failCount.delete(key);
      }
      for (const key of this.lastProbeAt.keys()) {
        if (!activeIds.has(key)) this.lastProbeAt.delete(key);
      }
      for (const key of this.thresholdHits.keys()) {
        if (!activeIds.has(key.split(':')[0])) this.thresholdHits.delete(key);
      }

      // U2: pre-cargar umbrales solo de las empresas con dispositivos activos en este ciclo
      const empresaIds = [...new Set(dispositivos.map(d => d.empresaId))];
      const umbrales = await this.umbralRepo.find({
        where: { empresaId: In(empresaIds), deletedAt: IsNull() },
      });

      this.logger.debug(`Ciclo iniciado: ${dispositivos.length} dispositivo(s)`);
      await this.runBatched(dispositivos, 10, umbrales);

    } catch (err: any) {
      this.logger.error(`Error crítico en ciclo de monitoreo: ${err.message}`);
    } finally {
      this.running = false;
    }
  }

  // ─── Ejecución por lotes con concurrencia controlada ─────────
  private async runBatched(
    items:       DispositivoMonitoreo[],
    concurrency: number,
    umbrales:    UmbralAlerta[],
  ): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
      const lote = items.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        lote.map(d => this.sondarDispositivo(d, umbrales)),
      );
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          this.logger.error(
            `sondeo[${lote[idx].nombreEmisor}] error no capturado: ${r.reason}`,
          );
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SONDEO INDIVIDUAL
  // ═══════════════════════════════════════════════════════════════
  private async sondarDispositivo(
    d:        DispositivoMonitoreo,
    umbrales: UmbralAlerta[],
  ): Promise<void> {
    // C3: respetar el intervalo por dispositivo
    const now = Date.now();
    const last = this.lastProbeAt.get(d.id) ?? 0;
    if (now - last < d.intervaloChequeoSeg * 1000) return;
    this.lastProbeAt.set(d.id, now);

    try {
      let result: ProbeResult;

      if (d.fabricante === Fabricante.MIKROTIK) {
        result = await this.sondarMikrotik(d);
      } else {
        result = await this.sondarPing(d.ipAddress);
      }

      this.failCount.set(d.id, 0);

      await this.persistirMetricas(d.id, result);

      // C1: emitir medición en tiempo real vía WebSocket
      this.gateway.emitirMedicion({
        nodoId:         d.id,
        empresaId:      d.empresaId,
        pingLatenciaMs: result.pingLatenciaMs,
        pingLossPct:    result.pingLossPct,
        cpuUsagePct:    result.cpuUsagePct,
        memoryUsagePct: result.memoryUsagePct,
        trafficDownBps: result.trafficDownBps !== null ? String(result.trafficDownBps) : null,
        trafficUpBps:   result.trafficUpBps   !== null ? String(result.trafficUpBps)   : null,
        timestamp:      new Date().toISOString(),
      });

      await this.verificarUmbrales(d, result, umbrales);

      // Recuperación: si estaba OFFLINE/REVERIFICANDO, volver a ONLINE
      if (d.status !== StatusDispositivo.ONLINE) {
        await this.dispoRepo.update(d.id, {
          status:     StatusDispositivo.ONLINE,
          lastSeenAt: new Date(),
        });
        await this.alertaRepo.update(
          { dispositivoId: d.id, status: StatusAlerta.ACTIVA, nivel: NivelAlerta.CRITICA },
          { status: StatusAlerta.RESUELTA, resueltoAt: new Date() },
        );
        // C1: emitir recuperación de estado
        this.gateway.emitirNodoStatus({
          nodoId:    d.id,
          empresaId: d.empresaId,
          status:    StatusDispositivo.ONLINE,
          nombre:    d.nombreEmisor,
          timestamp: new Date().toISOString(),
        });
        this.logger.log(`Recuperado: ${d.nombreEmisor} → ONLINE`);
      } else {
        await this.dispoRepo.update(d.id, { lastSeenAt: new Date() });
      }

    } catch (err: any) {
      await this.manejarFallo(d, err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DEBOUNCE — mitigación de falsos positivos de OFFLINE
  // ═══════════════════════════════════════════════════════════════
  private async manejarFallo(d: DispositivoMonitoreo, motivo: string): Promise<void> {
    const intentos = (this.failCount.get(d.id) ?? 0) + 1;
    this.failCount.set(d.id, intentos);

    this.logger.warn(`[${d.nombreEmisor}] fallo #${intentos}: ${motivo}`);

    if (intentos === 1) {
      await this.dispoRepo.update(d.id, { status: StatusDispositivo.REVERIFICANDO });
      // C1: emitir estado REVERIFICANDO
      this.gateway.emitirNodoStatus({
        nodoId:    d.id,
        empresaId: d.empresaId,
        status:    StatusDispositivo.REVERIFICANDO,
        nombre:    d.nombreEmisor,
        timestamp: new Date().toISOString(),
      });
      this.logger.warn(`${d.nombreEmisor} → REVERIFICANDO (esperando confirmación)`);
      return;
    }

    if (intentos >= 2 && d.status !== StatusDispositivo.OFFLINE) {
      await this.dispoRepo.update(d.id, { status: StatusDispositivo.OFFLINE });
      await this.crearAlertaDeduplicada(
        d,
        NivelAlerta.CRITICA,
        'CONECTIVIDAD',
        `Dispositivo ${d.nombreEmisor} (${d.ipAddress}) sin respuesta` +
          ` tras ${intentos} intentos consecutivos. Motivo: ${motivo}`,
        String(intentos),
        '2',
      );
      // C1: emitir estado OFFLINE
      this.gateway.emitirNodoStatus({
        nodoId:    d.id,
        empresaId: d.empresaId,
        status:    StatusDispositivo.OFFLINE,
        nombre:    d.nombreEmisor,
        timestamp: new Date().toISOString(),
      });
      this.logger.error(`${d.nombreEmisor} → OFFLINE — alerta CRITICA registrada`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SONDEO MIKROTIK (API RouterOS)
  // ═══════════════════════════════════════════════════════════════
  private async sondarMikrotik(d: DispositivoMonitoreo): Promise<ProbeResult> {
    const creds = this.buildCreds(d);

    return this.pool.execute(creds, async (api: any) => {
      const result: ProbeResult = {
        pingLatenciaMs: null,
        pingLossPct:    0,
        cpuUsagePct:    null,
        memoryUsagePct: null,
        trafficDownBps: null,
        trafficUpBps:   null,
      };

      // U4: medir latencia de red usando el RTT del primer comando API
      try {
        const t0 = Date.now();
        const [res] = await api.write('/system/resource/print');
        result.pingLatenciaMs = Date.now() - t0;

        result.cpuUsagePct = parseInt(res['cpu-load'] ?? '0', 10);

        const freeM  = parseInt(res['free-memory']  ?? '0', 10);
        const totalM = parseInt(res['total-memory'] ?? '1', 10);
        result.memoryUsagePct = Math.round((1 - freeM / totalM) * 100);
      } catch (e: any) {
        this.logger.warn(`[${d.nombreEmisor}] /system/resource: ${e.message}`);
      }

      // Tráfico por interfaz principal
      try {
        const ifaces: any[] = await api.write('/interface/print', ['?disabled=no']);
        if (ifaces.length > 0) {
          const target =
            ifaces.find(i => i['type'] === 'wlan') ?? ifaces[0];
          const ifaceName: string = target['name'];

          const [traffic] = await api.write('/interface/monitor-traffic', [
            `=interface=${ifaceName}`,
            '=count=1',
          ]);
          result.trafficDownBps = parseInt(
            traffic['rx-bits-per-second'] ?? '0', 10,
          );
          result.trafficUpBps = parseInt(
            traffic['tx-bits-per-second'] ?? '0', 10,
          );
        }
      } catch (e: any) {
        this.logger.warn(`[${d.nombreEmisor}] /interface/monitor-traffic: ${e.message}`);
      }

      return result;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // SONDEO GENÉRICO — ping ICMP
  // ═══════════════════════════════════════════════════════════════
  private async sondarPing(ip: string): Promise<ProbeResult> {
    if (!net.isIPv4(ip) && !net.isIPv6(ip)) {
      throw new Error(`Dirección IP inválida para ping: ${ip}`);
    }

    const { stdout } = await execAsync(
      // C2: "--" evita que la IP sea interpretada como flag por ping
      `ping -c 5 -W 3 -q -- ${ip}`,
      { timeout: 20_000 },
    ).catch((err: any) => {
      if (err.stdout) return { stdout: err.stdout as string };
      throw new Error(`ping no disponible o host inalcanzable: ${err.message}`);
    });

    const lossMatch = stdout.match(/(\d+)%\s+packet loss/);
    const lossPct   = lossMatch ? parseInt(lossMatch[1], 10) : 100;

    if (lossPct === 100) {
      throw new Error('100% packet loss');
    }

    const rttMatch  = stdout.match(/rtt .* = [\d.]+\/([\d.]+)\//);
    const latencyMs = rttMatch ? Math.round(parseFloat(rttMatch[1])) : null;

    return {
      pingLatenciaMs: latencyMs,
      pingLossPct:    lossPct,
      cpuUsagePct:    null,
      memoryUsagePct: null,
      trafficDownBps: null,
      trafficUpBps:   null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CLIENTES WIRELESS — tabla de registro AP
  // ═══════════════════════════════════════════════════════════════
  async getClientesWireless(d: DispositivoMonitoreo): Promise<WirelessClient[]> {
    const creds = this.buildCreds(d);

    return this.pool.execute(creds, async (api: any) => {
      const entries: any[] = await api.write(
        '/interface/wireless/registration-table/print',
      );

      return entries.map(e => {
        const signalRaw: string = e['signal-strength'] ?? '';
        const signalDbm = parseInt(signalRaw.split('@')[0] ?? '0', 10);

        return {
          mac:          e['mac-address']   ?? '',
          interfaz:     e['interface']     ?? '',
          signalDbm,
          snr:          parseInt(e['signal-to-noise'] ?? '0', 10),
          txRate:       e['tx-rate']       ?? '',
          rxRate:       e['rx-rate']       ?? '',
          uptime:       e['uptime']        ?? '',
          lastActivity: e['last-activity'] ?? '',
          txCcq:        parseInt(e['tx-ccq'] ?? '0', 10),
          rxCcq:        parseInt(e['rx-ccq'] ?? '0', 10),
          pThroughput:  parseInt(e['p-throughput'] ?? '0', 10),
          comment:      e['comment'] ?? '',
        } satisfies WirelessClient;
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // VERIFICACIÓN DE UMBRALES
  // ═══════════════════════════════════════════════════════════════
  private async verificarUmbrales(
    d:        DispositivoMonitoreo,
    result:   ProbeResult,
    umbrales: UmbralAlerta[],  // U2: pre-cargados en runCycle
  ): Promise<void> {
    const umbral = this.findUmbralAplicable(d.id, d.tipoEquipo, d.empresaId, umbrales);
    if (!umbral) return;

    const nivel = (umbral.nivelAlerta as NivelAlerta) ?? NivelAlerta.WARNING;

    type Check = {
      activo:    boolean;
      categoria: string;
      mensaje:   string;
      valor:     string;
      threshold: string;
      nivel:     NivelAlerta;
    };

    const checks: Check[] = [
      {
        activo:    umbral.latenciaMaxMs !== null
                   && result.pingLatenciaMs !== null
                   && result.pingLatenciaMs > umbral.latenciaMaxMs,
        categoria: 'LATENCIA',
        mensaje:   `Latencia ${result.pingLatenciaMs} ms supera el umbral de ${umbral.latenciaMaxMs} ms`,
        valor:     String(result.pingLatenciaMs),
        threshold: String(umbral.latenciaMaxMs),
        nivel,
      },
      {
        activo:    umbral.lossMaxPct !== null
                   && result.pingLossPct !== null
                   && result.pingLossPct > umbral.lossMaxPct,
        categoria: 'LOSS',
        mensaje:   `Pérdida de paquetes ${result.pingLossPct}% supera el umbral de ${umbral.lossMaxPct}%`,
        valor:     String(result.pingLossPct),
        threshold: String(umbral.lossMaxPct),
        nivel,
      },
      {
        activo:    umbral.cpuMaxPct !== null
                   && result.cpuUsagePct !== null
                   && result.cpuUsagePct > umbral.cpuMaxPct,
        categoria: 'CPU',
        mensaje:   `CPU ${result.cpuUsagePct}% supera el umbral de ${umbral.cpuMaxPct}%`,
        valor:     String(result.cpuUsagePct),
        threshold: String(umbral.cpuMaxPct),
        nivel,   // A5: nivel viene del umbral configurado, sin override hardcodeado
      },
      {
        activo:    umbral.memoryMaxPct !== null
                   && result.memoryUsagePct !== null
                   && result.memoryUsagePct > umbral.memoryMaxPct,
        categoria: 'MEMORIA',
        mensaje:   `Memoria ${result.memoryUsagePct}% supera el umbral de ${umbral.memoryMaxPct}%`,
        valor:     String(result.memoryUsagePct),
        threshold: String(umbral.memoryMaxPct),
        nivel,
      },
    ];

    for (const chk of checks) {
      const key = `${d.id}:${chk.categoria}`;

      if (!chk.activo) {
        // A1: resetear contador de confirmaciones consecutivas
        this.thresholdHits.delete(key);
        // A2: auto-resolver alerta WARNING si la métrica ya está dentro del umbral
        await this.alertaRepo.update(
          {
            dispositivoId: d.id,
            categoria:     chk.categoria,
            status:        StatusAlerta.ACTIVA,
            nivel:         NivelAlerta.WARNING,
          },
          { status: StatusAlerta.RESUELTA, resueltoAt: new Date() },
        );
        continue;
      }

      // A1: acumular confirmaciones antes de generar la alerta
      const hits = (this.thresholdHits.get(key) ?? 0) + 1;
      this.thresholdHits.set(key, hits);

      if (hits < umbral.confirmacionesRequeridas) {
        this.logger.debug(
          `[${d.nombreEmisor}] ${chk.categoria}: confirmación ${hits}/${umbral.confirmacionesRequeridas}`,
        );
        continue;
      }

      await this.crearAlertaDeduplicada(
        d, chk.nivel, chk.categoria, chk.mensaje, chk.valor, chk.threshold,
      );
      // Clampear el contador al techo para que no crezca indefinidamente y
      // para que, si la alerta se resuelve externamente, el debounce se respete
      this.thresholdHits.set(key, umbral.confirmacionesRequeridas);
    }
  }

  // ─── Umbral con prioridad: dispositivo > tipo_equipo > global ─
  // U2: versión síncrona sobre lista pre-cargada (0 queries)
  private findUmbralAplicable(
    dispositivoId: string,
    tipoEquipo:    TipoEquipo,
    empresaId:     string,
    umbrales:      UmbralAlerta[],
  ): UmbralAlerta | null {
    return (
      umbrales.find(u => u.dispositivoId === dispositivoId)
      ?? umbrales.find(u => u.empresaId === empresaId && u.tipoEquipo === tipoEquipo && u.dispositivoId === null)
      ?? umbrales.find(u =>
          u.empresaId === empresaId &&
          u.tipoEquipo === null &&
          u.dispositivoId === null,
        )
      ?? null
    );
  }

  // ─── Crear alerta sin duplicar + emitir por WS ────────────────
  private async crearAlertaDeduplicada(
    d:         DispositivoMonitoreo,
    nivel:     NivelAlerta,
    categoria: string,
    mensaje:   string,
    valorDet:  string,
    valorUmb:  string,
  ): Promise<void> {
    const existe = await this.alertaRepo.findOne({
      where: {
        dispositivoId: d.id,
        categoria,
        status: StatusAlerta.ACTIVA,
      },
    });
    if (existe) return;

    const alerta = await this.alertaRepo.save(
      this.alertaRepo.create({
        empresaId:      d.empresaId,
        dispositivoId:  d.id,
        nivel,
        categoria,
        mensaje,
        valorDetectado: valorDet,
        valorUmbral:    valorUmb,
        status:         StatusAlerta.ACTIVA,
      }),
    );

    // C1: emitir alerta en tiempo real
    this.gateway.emitirAlerta({
      nodoId:    d.id,
      empresaId: d.empresaId,
      alertaId:  alerta.id,
      nivel,
      categoria,
      mensaje,
      timestamp: new Date().toISOString(),
    });

    this.logger.warn(`Alerta [${nivel}/${categoria}] creada para ${d.nombreEmisor}`);
  }

  // ─── Persistir métricas ───────────────────────────────────────
  private async persistirMetricas(
    dispositivoId: string,
    r: ProbeResult,
  ): Promise<void> {
    await this.metricasRepo.save(
      this.metricasRepo.create({
        dispositivoId,
        pingLatenciaMs: r.pingLatenciaMs,
        pingLossPct:    r.pingLossPct,
        cpuUsagePct:    r.cpuUsagePct,
        memoryUsagePct: r.memoryUsagePct,
        trafficDownBps: r.trafficDownBps !== null ? String(r.trafficDownBps) : null,
        trafficUpBps:   r.trafficUpBps   !== null ? String(r.trafficUpBps)   : null,
        timestamp:      new Date(),
      }),
    );
  }

  // ─── Construir credenciales para el pool ──────────────────────
  private buildCreds(d: DispositivoMonitoreo): RouterCreds {
    return {
      id:              d.id,
      ip:              d.ipAddress,
      port:            d.useSsl ? 8729 : d.puertoApi,
      user:            d.usuario    ?? 'admin',
      passwordCifrado: d.contrasenaCifrada ?? '',
      useSsl:          d.useSsl,
      // C4: timeout entre 5s y 25s, nunca negativo
      timeoutSec:      Math.min(Math.max(d.intervaloChequeoSeg - 5, 5), 25),
      version:         'v6',
    };
  }
}

// ─── Tipo exportado para el controlador ──────────────────────────
export interface WirelessClient {
  mac:          string;
  interfaz:     string;
  signalDbm:    number;
  snr:          number;
  txRate:       string;
  rxRate:       string;
  uptime:       string;
  lastActivity: string;
  txCcq:        number;
  rxCcq:        number;
  pThroughput:  number;
  comment:      string;
}
