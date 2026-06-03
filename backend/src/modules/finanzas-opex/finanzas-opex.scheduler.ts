import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FinanzasOpexService } from './finanzas-opex.service';
import { GatewayMensajeriaService } from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion } from '../notificaciones/services/whatsapp.service';

@Injectable()
export class FinanzasOpexScheduler {
  private readonly logger = new Logger(FinanzasOpexScheduler.name);

  constructor(
    private readonly svc:     FinanzasOpexService,
    private readonly events:  EventEmitter2,
    private readonly gateway: GatewayMensajeriaService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // Corre cada día a las 07:00 hora Lima.
  // Solo la instancia PM2 id=0 ejecuta para evitar duplicados en cluster.
  @Cron('0 7 * * *', { timeZone: 'America/Lima', name: 'generar-pendientes-opex' })
  async generarPendientesRecurrentes(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== '0') return;

    const hoy = new Date();
    this.logger.log(
      `[OPEX-CRON] Verificando obligaciones recurrentes — día ${hoy.getDate()} del mes`,
    );

    try {
      const { generados } = await this.svc.generarPendientesDelDia(hoy);

      if (generados > 0) {
        this.logger.warn(
          `[OPEX-CRON] ${generados} obligación(es) generada(s) como PENDIENTE_PAGO`,
        );
        // Emite evento para que otros módulos (notificaciones, dashboard) puedan reaccionar
        this.events.emit('finanzas.opex.pendientes_generados', {
          cantidad: generados,
          fecha:    hoy.toISOString().split('T')[0],
        });
        await this.notificarEgresos(generados, hoy.toISOString().split('T')[0]);
      } else {
        this.logger.debug('[OPEX-CRON] Sin obligaciones para hoy');
      }
    } catch (err: any) {
      this.logger.error(`[OPEX-CRON] Error al generar pendientes: ${err.message}`, err.stack);
    }
  }

  private async notificarEgresos(cantidad: number, fecha: string): Promise<void> {
    try {
      const empresas: { id: string; razon_social: string }[] = await this.ds.query(
        `SELECT id, razon_social FROM empresas WHERE estado = 'activo'`,
      );
      for (const e of empresas) {
        await this.gateway.despachar({
          telefono:  '',
          tipo:      TipoNotificacion.ALERTA_EGRESO,
          variables: { nombreEmpresa: e.razon_social, cantidad: String(cantidad), fecha },
          empresaId: e.id,
        });
      }
    } catch (err: any) {
      this.logger.error(`[OPEX-CRON] Error notificando egresos: ${err.message}`);
    }
  }
}
