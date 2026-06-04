import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository, In }     from 'typeorm';
import { Cron }               from '@nestjs/schedule';

import { OltDispositivo, OltMetodoConexion } from './entities/olt-dispositivo.entity';
import { MetricasOnuOptical }                from './entities/metricas-onu-optical.entity';
import { Onu, EstadoOnu, EstadoOlt }         from '../smartolt/entities/onu.entity';
import { AlertaSistema }                      from '../monitoreo/entities/alerta-sistema.entity';
import { NivelAlerta, StatusAlerta }          from '../monitoreo/enums/monitoreo.enums';
import { OltAutomationClient }               from './olt-automation.client';
import { decrypt }                           from '../../common/utils/encryption.util';
import {
  PythonBatchStatusRequest,
  PythonBatchStatusResponse,
  PythonOnuQueryInfo,
  PythonOnuStatusInfo,
} from './dto/olt-nativo-ops.dto';

// ──────────────────────────────────────────────────────────────────
// OltMonitoreoService  —  Sincronización inversa + conciliación
//
// Cron @5min (misma ventana que pollRouterMetrics en MikrotikService).
// Mismo guardia PM2: solo corre en la instancia #0 del clúster.
//
// Flujo por OLT:
//   1. Descifra credenciales en memoria
//   2. Llama Python /batch-status  (UNA sesión SSH por puerto PON)
//   3. Concilia estado ONLINE/OFFLINE/ERROR en tabla `onus`
//   4. Persiste historial óptico en `metricas_onu_optical`
//   5. Crea alertas de señal degradada y pérdida de conectividad
//
// Regla crítica de caída VPN:
//   Si Python no responde → marcar OLT como OFFLINE, NO tocar ONUs.
//   Se emite UNA alerta crítica global. Los estados se "congelan".
// ──────────────────────────────────────────────────────────────────
@Injectable()
export class OltMonitoreoService {
  private readonly logger = new Logger(OltMonitoreoService.name);

  private readonly RX_DEGRADADA_DBM = -27.0;  // Señal sucia / fibra doblada
  private readonly RX_CRITICA_DBM   = -30.0;  // Corte inminente

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(Onu)
    private readonly onuRepo: Repository<Onu>,

    @InjectRepository(MetricasOnuOptical)
    private readonly metricasRepo: Repository<MetricasOnuOptical>,

    @InjectRepository(AlertaSistema)
    private readonly alertaRepo: Repository<AlertaSistema>,

    private readonly automation: OltAutomationClient,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // CRON — cada 5 minutos, solo instancia PM2 #0
  // ────────────────────────────────────────────────────────────────
  @Cron('*/5 * * * *', { timeZone: 'America/Lima' })
  async pollOltMetrics(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;

    let olts: OltDispositivo[];
    try {
      olts = await this.oltRepo.find({
        where: [
          { activo: true, metodoConexion: OltMetodoConexion.NATIVO_SSH  },
          { activo: true, metodoConexion: OltMetodoConexion.NATIVO_SNMP },
        ],
        order: { nombre: 'ASC' },
      });
    } catch (err) {
      this.logger.error(`pollOltMetrics: error consultando OLTs — ${err.message}`);
      return;
    }

    if (!olts.length) return;

    this.logger.log(`OLT monitoreo: ${olts.length} OLT(s) a procesar`);

    // Procesamiento secuencial — no paralelizar OLTs.
    // Cada OLT ocupa su propio lock SSH en Python (connection_pool)
    // y un túnel VPN independiente.
    for (const olt of olts) {
      try {
        await this.pollOlt(olt);
      } catch (err) {
        this.logger.error(
          `pollOlt crash inesperado en "${olt.nombre}": ${err.message}`,
        );
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // pollOlt  —  ciclo completo de una OLT
  // ────────────────────────────────────────────────────────────────
  private async pollOlt(olt: OltDispositivo): Promise<void> {
    const onus = await this.onuRepo.find({
      where: {
        oltId: olt.id,
        estado: In([
          EstadoOnu.APROVISIONADA,
          EstadoOnu.ONLINE,
          EstadoOnu.OFFLINE,
          EstadoOnu.ERROR,
        ]),
      },
    });

    if (!onus.length) return;

    // Descifrar contraseña — solo vive en memoria durante esta función
    let password: string;
    try {
      password = decrypt(olt.contrasenaCifrada);
    } catch {
      this.logger.error(`No se pudo descifrar credenciales de OLT "${olt.nombre}"`);
      return;
    }

    // Construir payload: solo ONUs con coordenadas PON completas
    const onuQueries: PythonOnuQueryInfo[] = onus
      .filter(o => o.ponSlot != null && o.ponPortNum != null && o.onuId != null)
      .map(o => ({
        slot:   o.ponSlot,
        port:   o.ponPortNum,
        onu_id: o.onuId,
        sn:     o.serialNumber,
      }));

    if (!onuQueries.length) return;

    const req: PythonBatchStatusRequest = {
      connection: {
        ip:       olt.ipGestion,
        port:     olt.puerto,
        username: olt.usuarioAnclado,
        password,
        brand:    olt.marca,
      },
      onus: onuQueries,
    };

    // ── Llamada al microservicio Python ────────────────────────
    let batch: PythonBatchStatusResponse;
    try {
      batch = await this.automation.batchStatus(req);
    } catch (err) {
      // VPN caída / OLT sin energía / timeout — congelar estados
      await this.handleOltCaida(olt, err.message);
      return;
    }

    if (!batch.success) {
      await this.handleOltCaida(olt, batch.error ?? 'batch-status sin mensaje');
      return;
    }

    // OLT respondió — marcar como online y resolver alerta previa
    await this.oltRepo.update(olt.id, {
      estado:     EstadoOlt.ONLINE,
      ultimoPing: new Date(),
    });
    await this.resolverAlertaConectividad(olt);

    // Índice de resultados del hardware: clave = "slot.port.onu_id"
    const hwMap = new Map<string, PythonOnuStatusInfo>();
    for (const item of batch.onus) {
      hwMap.set(`${item.slot}.${item.port}.${item.onu_id}`, item);
    }

    // ── Conciliación ONU por ONU ───────────────────────────────
    const metricsInsert: Partial<MetricasOnuOptical>[] = [];
    const now = new Date();
    let onusOnline = 0;

    for (const onu of onus) {
      if (onu.ponSlot == null || onu.ponPortNum == null || onu.onuId == null) continue;

      const key = `${onu.ponSlot}.${onu.ponPortNum}.${onu.onuId}`;
      const hw  = hwMap.get(key);

      // Caso: ONU no reportada por el hardware en absoluto → huérfana
      if (hw === undefined) {
        await this.marcarOnuHuerfana(onu, olt);
        continue;
      }

      // Caso: estado desconocido (fallo de puerto, no de OLT) → dejar tal cual
      if (hw.run_state === 'unknown') continue;

      // Caso normal: sincronizar estado
      const nuevoEstado = hw.run_state === 'online'
        ? EstadoOnu.ONLINE
        : EstadoOnu.OFFLINE;

      const updates: Partial<Onu> = { estado: nuevoEstado };
      if (hw.run_state === 'online') {
        updates.ultimoOnline = now;
        onusOnline++;
      }
      if (hw.rx_power_dbm  != null) updates.rxPowerDbm   = hw.rx_power_dbm;
      if (hw.tx_power_dbm  != null) updates.txPowerDbm   = hw.tx_power_dbm;
      if (hw.temperature_c != null) updates.temperaturaC = hw.temperature_c;

      await this.onuRepo.update(onu.id, updates);

      // Historial óptico (solo si hay al menos una métrica)
      if (hw.rx_power_dbm != null || hw.tx_power_dbm != null) {
        metricsInsert.push({
          onuId:           onu.id,
          oltDispositivoId: olt.id,
          empresaId:       olt.empresaId,
          rxPowerDbm:      hw.rx_power_dbm,
          txPowerDbm:      hw.tx_power_dbm,
          temperaturaC:    hw.temperature_c,
          timestamp:       now,
        });
      }

      // Evaluación de umbral de señal
      if (hw.run_state === 'online' && hw.rx_power_dbm != null) {
        await this.evaluarUmbralSenial(onu, olt, hw.rx_power_dbm);
      }
    }

    // Inserción masiva de historial óptico
    if (metricsInsert.length) {
      await this.metricasRepo
        .createQueryBuilder()
        .insert()
        .into(MetricasOnuOptical)
        .values(metricsInsert)
        .execute()
        .catch(err =>
          this.logger.warn(`bulk-insert métricas ONU: ${err.message}`),
        );
    }

    // Actualizar contador de ONUs activas en la OLT
    await this.oltRepo.update(olt.id, { onusActivas: onusOnline });

    this.logger.log(
      `OLT "${olt.nombre}": ${batch.total} reportadas | ` +
      `${onusOnline} online | ${metricsInsert.length} métricas guardadas`,
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Caída de VPN / OLT sin energía / timeout
  //
  // Regla estricta: NO modificar estados de ONUs.
  // Solo marcar la OLT y emitir UNA alerta crítica (no duplicar).
  // ────────────────────────────────────────────────────────────────
  private async handleOltCaida(olt: OltDispositivo, reason: string): Promise<void> {
    this.logger.warn(
      `OLT "${olt.nombre}" (${olt.ipGestion}) inaccesible — ${reason}`,
    );

    await this.oltRepo.update(olt.id, { estado: EstadoOlt.OFFLINE });

    if (!olt.dispositivoMonitoreoId) return;

    const existente = await this.alertaRepo.findOne({
      where: {
        dispositivoId: olt.dispositivoMonitoreoId,
        categoria:     'OLT_CONECTIVIDAD',
        status:        StatusAlerta.ACTIVA,
      },
    });

    if (existente) return;  // ya existe alerta activa — no duplicar

    await this.alertaRepo.save(
      this.alertaRepo.create({
        empresaId:      olt.empresaId,
        dispositivoId:  olt.dispositivoMonitoreoId,
        nivel:          NivelAlerta.CRITICA,
        categoria:      'OLT_CONECTIVIDAD',
        mensaje:        `Pérdida de conectividad con OLT "${olt.nombre}" (${olt.ipGestion}): ${reason}`,
        valorDetectado: reason.substring(0, 50),
        valorUmbral:    null,
        status:         StatusAlerta.ACTIVA,
        resueltoAt:     null,
        resueltoPorId:  null,
      }),
    );
  }

  // ────────────────────────────────────────────────────────────────
  // OLT volvió a responder — auto-resolver alerta de conectividad
  // ────────────────────────────────────────────────────────────────
  private async resolverAlertaConectividad(olt: OltDispositivo): Promise<void> {
    if (!olt.dispositivoMonitoreoId) return;

    await this.alertaRepo.update(
      {
        dispositivoId: olt.dispositivoMonitoreoId,
        categoria:     'OLT_CONECTIVIDAD',
        status:        StatusAlerta.ACTIVA,
      },
      {
        status:        StatusAlerta.RESUELTA,
        resueltoAt:    new Date(),
        resueltoPorId: null,
      },
    );
  }

  // ────────────────────────────────────────────────────────────────
  // ONU no encontrada en hardware
  //
  // Causas: borrada manualmente por consola, reset de fábrica,
  // o cambio de SN tras reemplazo físico no registrado.
  // ────────────────────────────────────────────────────────────────
  private async marcarOnuHuerfana(onu: Onu, olt: OltDispositivo): Promise<void> {
    if (onu.estado === EstadoOnu.ERROR) return;  // ya marcada — no re-alertar

    this.logger.warn(
      `ONU huérfana: SN=${onu.serialNumber} en OLT "${olt.nombre}" ` +
      `[slot=${onu.ponSlot} port=${onu.ponPortNum} id=${onu.onuId}] — no existe en hardware`,
    );

    await this.onuRepo.update(onu.id, { estado: EstadoOnu.ERROR });

    if (!olt.dispositivoMonitoreoId) return;

    await this.alertaRepo.save(
      this.alertaRepo.create({
        empresaId:      olt.empresaId,
        dispositivoId:  olt.dispositivoMonitoreoId,
        nivel:          NivelAlerta.WARNING,
        categoria:      'ONU_HUERFANA',
        mensaje:        (
          `ONU SN=${onu.serialNumber} no encontrada físicamente en OLT "${olt.nombre}" ` +
          `(slot=${onu.ponSlot} port=${onu.ponPortNum} id=${onu.onuId}). ` +
          `Puede haber sido removida manualmente o reseteada a fábrica.`
        ),
        valorDetectado: onu.serialNumber,
        valorUmbral:    null,
        status:         StatusAlerta.ACTIVA,
        resueltoAt:     null,
        resueltoPorId:  null,
      }),
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Evaluación de umbral de señal óptica
  //
  // RxPower ≥ -27 dBm   → señal OK, auto-resolver alerta previa
  // RxPower < -27 dBm   → WARNING  (fibra sucia / doblada)
  // RxPower < -30 dBm   → CRITICA  (corte inminente)
  //
  // Deduplicación: una sola alerta ACTIVA por ONU por categoría.
  // Si escala de WARNING a CRITICA, actualiza el nivel sin duplicar.
  // ────────────────────────────────────────────────────────────────
  private async evaluarUmbralSenial(
    onu: Onu,
    olt: OltDispositivo,
    rx:  number,
  ): Promise<void> {
    if (!olt.dispositivoMonitoreoId) return;

    if (rx >= this.RX_DEGRADADA_DBM) {
      // Señal OK — auto-resolver cualquier alerta de señal activa para esta ONU
      await this.alertaRepo.update(
        {
          dispositivoId:  olt.dispositivoMonitoreoId,
          categoria:      'ONU_SIGNAL',
          valorDetectado: onu.serialNumber,
          status:         StatusAlerta.ACTIVA,
        },
        {
          status:        StatusAlerta.RESUELTA,
          resueltoAt:    new Date(),
          resueltoPorId: null,
        },
      );
      return;
    }

    const nivel = rx < this.RX_CRITICA_DBM ? NivelAlerta.CRITICA : NivelAlerta.WARNING;

    const existente = await this.alertaRepo.findOne({
      where: {
        dispositivoId:  olt.dispositivoMonitoreoId,
        categoria:      'ONU_SIGNAL',
        valorDetectado: onu.serialNumber,
        status:         StatusAlerta.ACTIVA,
      },
    });

    if (existente) {
      // Escalar nivel si empeoró — no crear nueva alerta
      if (nivel === NivelAlerta.CRITICA && existente.nivel !== NivelAlerta.CRITICA) {
        await this.alertaRepo.update(existente.id, { nivel });
      }
      return;
    }

    const descripcion = rx < this.RX_CRITICA_DBM
      ? `CRÍTICA — posible corte (${rx.toFixed(2)} dBm, umbral: ${this.RX_CRITICA_DBM} dBm)`
      : `DEGRADADA — fibra sucia o doblada (${rx.toFixed(2)} dBm, umbral: ${this.RX_DEGRADADA_DBM} dBm)`;

    await this.alertaRepo.save(
      this.alertaRepo.create({
        empresaId:      olt.empresaId,
        dispositivoId:  olt.dispositivoMonitoreoId,
        nivel,
        categoria:      'ONU_SIGNAL',
        mensaje:        `ONU SN=${onu.serialNumber} en OLT "${olt.nombre}": señal Rx ${descripcion}`,
        valorDetectado: onu.serialNumber,
        valorUmbral:    this.RX_DEGRADADA_DBM.toString(),
        status:         StatusAlerta.ACTIVA,
        resueltoAt:     null,
        resueltoPorId:  null,
      }),
    );
  }
}
