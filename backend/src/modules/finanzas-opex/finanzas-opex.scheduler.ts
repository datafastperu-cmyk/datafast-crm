import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FinanzasOpexService } from './finanzas-opex.service';
import { EgresoIngreso } from './egreso-ingreso.entity';
import { EmpresaConfigService } from '../config/empresa-config.service';

@Injectable()
export class FinanzasOpexScheduler implements OnModuleInit {
  private readonly logger = new Logger(FinanzasOpexScheduler.name);

  constructor(
    private readonly svc:     FinanzasOpexService,
    private readonly events:  EventEmitter2,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly empresaConfig:     EmpresaConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    const tz = await this.empresaConfig.getTimezone().catch(() => 'America/Lima');
    const job = new CronJob('0 7 * * *', () => this.generarPendientesRecurrentes(), null, true, tz);
    this.schedulerRegistry.addCronJob('generar-pendientes-opex', job);
  }

  // Corre cada día a las 07:00 en la zona horaria configurada en la empresa.
  // Solo la instancia PM2 id=0 ejecuta para evitar duplicados en cluster.
  async generarPendientesRecurrentes(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;

    const hoy = new Date();
    this.logger.log(
      `[OPEX-CRON] Verificando obligaciones recurrentes — día ${hoy.getDate()} del mes`,
    );

    try {
      const { generados, recordatorios } = await this.svc.generarPendientesDelDia(hoy);

      if (generados.length > 0) {
        this.logger.warn(`[OPEX-CRON] ${generados.length} obligación(es) generada(s) como PENDIENTE_PAGO`);
        this.events.emit('finanzas.opex.pendientes_generados', {
          cantidad: generados.length,
          fecha:    hoy.toISOString().split('T')[0],
        });
        await this.notificarEgresos(generados, hoy);
      }

      if (recordatorios.length > 0) {
        this.logger.warn(`[OPEX-CRON] ${recordatorios.length} recordatorio(s) de obligaciones pendientes`);
        await this.notificarEgresos(recordatorios, hoy);
      }

      if (generados.length === 0 && recordatorios.length === 0) {
        this.logger.debug('[OPEX-CRON] Sin obligaciones para hoy');
      }
    } catch (err: any) {
      this.logger.error(`[OPEX-CRON] Error al generar pendientes: ${err.message}`, err.stack);
    }
  }

  // Envía una alerta por cada egreso individual vía Event Emitter.
  // El evento es capturado por NotificationEventListener → Bull → MensajeriaWorker → tabla logs.
  private async notificarEgresos(egresos: EgresoIngreso[], hoy: Date): Promise<void> {
    for (const egreso of egresos) {
      try {
        const diasRestantes = (egreso.diaVencimiento ?? hoy.getDate()) - hoy.getDate();
        this.events.emit('notification.alerta.egreso', {
          telefono:      '',
          nombre_gasto:  egreso.descripcion ?? 'Egreso recurrente',
          categoria:     egreso.categoria,
          monto:         parseFloat(String(egreso.monto)).toFixed(2),
          dias_restantes: String(diasRestantes),
          empresaId:     egreso.empresaId,
        });
        this.logger.debug(`[OPEX-CRON] Evento alerta_egreso emitido: ${egreso.id}`);
      } catch (err: any) {
        this.logger.error(`[OPEX-CRON] Error emitiendo alerta_egreso ${egreso.id}: ${err.message}`);
      }
    }
  }
}
