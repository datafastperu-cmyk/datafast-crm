import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FinanzasOpexService } from './finanzas-opex.service';
import { EgresoIngreso } from './egreso-ingreso.entity';
import { GatewayMensajeriaService } from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion } from '../notificaciones/services/whatsapp.service';

@Injectable()
export class FinanzasOpexScheduler {
  private readonly logger = new Logger(FinanzasOpexScheduler.name);

  constructor(
    private readonly svc:     FinanzasOpexService,
    private readonly events:  EventEmitter2,
    private readonly gateway: GatewayMensajeriaService,
  ) {}

  // Corre cada día a las 07:00 hora Lima.
  // Solo la instancia PM2 id=0 ejecuta para evitar duplicados en cluster.
  @Cron('0 7 * * *', { timeZone: 'America/Lima', name: 'generar-pendientes-opex' })
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

  // Envía una alerta por cada egreso individual usando las variables del template.
  // dias_restantes negativo = vencido hace N días.
  private async notificarEgresos(egresos: EgresoIngreso[], hoy: Date): Promise<void> {
    for (const egreso of egresos) {
      try {
        const diasRestantes = (egreso.diaVencimiento ?? hoy.getDate()) - hoy.getDate();
        await this.gateway.despachar({
          telefono:  '',
          tipo:      TipoNotificacion.ALERTA_EGRESO,
          variables: {
            nombre_gasto:   egreso.descripcion ?? 'Egreso recurrente',
            categoria:      egreso.categoria,
            monto:          parseFloat(String(egreso.monto)).toFixed(2),
            dias_restantes: String(diasRestantes),
          },
          empresaId: egreso.empresaId,
        });
      } catch (err: any) {
        this.logger.error(`[OPEX-CRON] Error notificando egreso ${egreso.id}: ${err.message}`);
      }
    }
  }
}
