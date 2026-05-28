// Ruta: /opt/datafast/backend/src/modules/monitoreo/services/monitoreo-worker.service.ts
//
// Dependencias:
//   npm install @nestjs/schedule
//   En AppModule: ScheduleModule.forRoot()

import { Injectable, Logger }       from '@nestjs/common';
import { Cron, CronExpression }      from '@nestjs/schedule';
import { InjectRepository }          from '@nestjs/typeorm';
import { InjectDataSource }          from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
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
import { decrypt }               from '../../../common/utils/encryption.util';

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

  // Guard: evita que un ciclo lento se solape con el siguiente
  private running = false;

  // Debounce de alertas: deviceId → cantidad de fallos consecutivos
  private readonly failCount = new Map<string, number>();

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

    private readonly pool: RouterConnectionPool,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // CICLO PRINCIPAL — cada 60 segundos
  // ═══════════════════════════════════════════════════════════════
  @Cron(CronExpression.EVERY_MINUTE)
  async runCycle(): Promise<void> {
    // Solo la instancia 0 de PM2 ejecuta el worker; las demás abortan.
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

      this.logger.debug(`Ciclo iniciado: ${dispositivos.length} dispositivo(s)`);

      // Máximo 10 sondeos en paralelo para no saturar la red
      await this.runBatched(dispositivos, 10);

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
  ): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
      const lote = items.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        lote.map(d => this.sondarDispositivo(d)),
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
  private async sondarDispositivo(d: DispositivoMonitoreo): Promise<void> {
    try {
      let result: ProbeResult;

      if (d.fabricante === Fabricante.MIKROTIK) {
        result = await this.sondarMikrotik(d);
      } else {
        result = await this.sondarPing(d.ipAddress);
      }

      // Éxito → resetear contador de fallos
      this.failCount.set(d.id, 0);

      // Persistir métricas y verificar umbrales
      await this.persistirMetricas(d.id, result);
      await this.verificarUmbrales(d, result);

      // Recuperación: si estaba OFFLINE/REVERIFICANDO, volver a ONLINE
      if (d.status !== StatusDispositivo.ONLINE) {
        await this.dispoRepo.update(d.id, {
          status:     StatusDispositivo.ONLINE,
          lastSeenAt: new Date(),
        });
        // Resolver alertas CRITICA activas de este dispositivo
        await this.alertaRepo.update(
          { dispositivoId: d.id, status: StatusAlerta.ACTIVA, nivel: NivelAlerta.CRITICA },
          { status: StatusAlerta.RESUELTA, resueltoAt: new Date() },
        );
        this.logger.log(`Recuperado: ${d.nombreEmisor} → ONLINE`);
      } else {
        await this.dispoRepo.update(d.id, { lastSeenAt: new Date() });
      }

    } catch (err: any) {
      await this.manejarFallo(d, err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DEBOUNCE — lógica de mitigación de falsos positivos
  // ═══════════════════════════════════════════════════════════════
  private async manejarFallo(d: DispositivoMonitoreo, motivo: string): Promise<void> {
    const intentos = (this.failCount.get(d.id) ?? 0) + 1;
    this.failCount.set(d.id, intentos);

    this.logger.warn(
      `[${d.nombreEmisor}] fallo #${intentos}: ${motivo}`,
    );

    if (intentos === 1) {
      // Primer fallo: REVERIFICANDO (aún no alertamos)
      await this.dispoRepo.update(d.id, { status: StatusDispositivo.REVERIFICANDO });
      this.logger.warn(`${d.nombreEmisor} → REVERIFICANDO (esperando confirmación)`);
      return;
    }

    if (intentos >= 2 && d.status !== StatusDispositivo.OFFLINE) {
      // Segundo fallo consecutivo: OFFLINE + alerta CRITICA
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
        pingLossPct:    0,      // si llegamos aquí, hay conectividad
        cpuUsagePct:    null,
        memoryUsagePct: null,
        trafficDownBps: null,
        trafficUpBps:   null,
      };

      // ── CPU y Memoria ───────────────────────────────────────
      try {
        const [res] = await api.write('/system/resource/print');
        result.cpuUsagePct = parseInt(res['cpu-load'] ?? '0', 10);

        const freeM  = parseInt(res['free-memory']  ?? '0', 10);
        const totalM = parseInt(res['total-memory'] ?? '1', 10);
        result.memoryUsagePct = Math.round((1 - freeM / totalM) * 100);
      } catch (e: any) {
        this.logger.warn(`[${d.nombreEmisor}] /system/resource: ${e.message}`);
      }

      // ── Tráfico por interfaz principal ───────────────────────
      // Para ANTENA_AP usamos la interfaz wireless; para otros, la primera activa.
      try {
        const ifaces: any[] = await api.write('/interface/print', ['?disabled=no']);
        if (ifaces.length > 0) {
          // Preferir interfaz wireless si existe
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
  // SONDEO GENÉRICO — ping ICMP por consola del sistema
  // ═══════════════════════════════════════════════════════════════
  private async sondarPing(ip: string): Promise<ProbeResult> {
    // Linux: -c 5 paquetes, -W 3 timeout por paquete, -q salida resumida
    const { stdout } = await execAsync(
      `ping -c 5 -W 3 -q ${ip}`,
      { timeout: 20_000 },
    ).catch((err: any) => {
      // ping sale con código != 0 cuando hay pérdida total pero aún escribe stdout
      if (err.stdout) return { stdout: err.stdout as string };
      throw new Error(`ping no disponible o host inalcanzable: ${err.message}`);
    });

    // "5 packets transmitted, 3 received, 40% packet loss"
    const lossMatch = stdout.match(/(\d+)%\s+packet loss/);
    const lossPct   = lossMatch ? parseInt(lossMatch[1], 10) : 100;

    if (lossPct === 100) {
      throw new Error('100% packet loss');
    }

    // "rtt min/avg/max/mdev = 1.234/2.345/3.456/0.123 ms"
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
  // TABLA WIRELESS — clientes conectados a una ANTENA_AP
  // Usado también por el endpoint GET /monitoreo/dispositivos/:id/clientes
  // ═══════════════════════════════════════════════════════════════
  async getClientesWireless(d: DispositivoMonitoreo): Promise<WirelessClient[]> {
    const creds = this.buildCreds(d);

    return this.pool.execute(creds, async (api: any) => {
      const entries: any[] = await api.write(
        '/interface/wireless/registration-table/print',
      );

      return entries.map(e => {
        // signal-strength viene como "-65@6Mbps" — extraemos el dBm
        const signalRaw: string = e['signal-strength'] ?? '';
        const signalDbm = parseInt(signalRaw.split('@')[0] ?? '0', 10);

        return {
          mac:            e['mac-address']   ?? '',
          interfaz:       e['interface']     ?? '',
          signalDbm,
          snr:            parseInt(e['signal-to-noise'] ?? '0', 10),
          txRate:         e['tx-rate']       ?? '',
          rxRate:         e['rx-rate']       ?? '',
          uptime:         e['uptime']        ?? '',
          lastActivity:   e['last-activity'] ?? '',
          txCcq:          parseInt(e['tx-ccq'] ?? '0', 10),
          rxCcq:          parseInt(e['rx-ccq'] ?? '0', 10),
          pThroughput:    parseInt(e['p-throughput'] ?? '0', 10),
          comment:        e['comment'] ?? '',
        } satisfies WirelessClient;
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // VERIFICACIÓN DE UMBRALES
  // ═══════════════════════════════════════════════════════════════
  private async verificarUmbrales(
    d:      DispositivoMonitoreo,
    result: ProbeResult,
  ): Promise<void> {
    const umbral = await this.findUmbralAplicable(d.id, d.tipoEquipo, d.empresaId);
    if (!umbral) return;

    type Check = {
      activo:     boolean;
      categoria:  string;
      mensaje:    string;
      valor:      string;
      threshold:  string;
      nivel:      NivelAlerta;
    };

    const nivel = (umbral.nivelAlerta as NivelAlerta) ?? NivelAlerta.WARNING;

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
        nivel:     result.cpuUsagePct! >= 95 ? NivelAlerta.CRITICA : nivel,
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
      if (!chk.activo) continue;
      await this.crearAlertaDeduplicada(
        d, chk.nivel, chk.categoria, chk.mensaje, chk.valor, chk.threshold,
      );
    }
  }

  // ─── Umbral con prioridad: dispositivo > tipo_equipo > global ─
  private async findUmbralAplicable(
    dispositivoId: string,
    tipoEquipo:    TipoEquipo,
    empresaId:     string,
  ): Promise<UmbralAlerta | null> {
    // 1. Umbral específico del dispositivo
    const especifico = await this.umbralRepo.findOne({
      where: { dispositivoId, deletedAt: IsNull() },
    });
    if (especifico) return especifico;

    // 2. Umbral global por tipo de equipo
    const porTipo = await this.umbralRepo.findOne({
      where: { tipoEquipo, dispositivoId: IsNull(), deletedAt: IsNull() },
    });
    if (porTipo) return porTipo;

    // 3. Umbral global de empresa
    return this.umbralRepo.findOne({
      where: {
        empresaId,
        tipoEquipo: IsNull(),
        dispositivoId: IsNull(),
        deletedAt: IsNull(),
      },
    });
  }

  // ─── Crear alerta sin duplicar (misma categoría activa) ───────
  private async crearAlertaDeduplicada(
    d:          DispositivoMonitoreo,
    nivel:      NivelAlerta,
    categoria:  string,
    mensaje:    string,
    valorDet:   string,
    valorUmb:   string,
  ): Promise<void> {
    const existe = await this.alertaRepo.findOne({
      where: {
        dispositivoId: d.id,
        categoria,
        status: StatusAlerta.ACTIVA,
      },
    });
    if (existe) return; // ya hay alerta activa para esta categoría

    await this.alertaRepo.save(
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
      timeoutSec:      Math.min(d.intervaloChequeoSeg - 5, 25), // timeout < intervalo
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
