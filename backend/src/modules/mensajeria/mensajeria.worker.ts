import { Injectable, Logger } from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job }                               from 'bull';
import { InjectDataSource }                  from '@nestjs/typeorm';
import { DataSource }                        from 'typeorm';
import { GatewayMensajeriaService }          from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }                  from '../notificaciones/services/whatsapp.service';
import { QUEUES, JOBS }                      from '../workers/workers.constants';

// ─── Payload unificado de llegada desde NotificationEventListener ─
interface PayloadNotifEnvio {
  telefono:    string;
  tipo:        string;
  variables:   Record<string, string>;
  empresaId?:  string;
  contratoId?: string;
  clienteId?:  string;
  logId?:      string;
}

// ─── Cola NOTIFICACIONES: solo mensajes individuales del sistema ──
// Las campañas masivas van a la cola CAMPANAS (ver campanas.worker.ts)
// para no bloquear alertas críticas con el goteo de miles de mensajes.
@Processor(QUEUES.NOTIFICACIONES)
@Injectable()
export class MensajeriaWorker {
  private readonly logger = new Logger(MensajeriaWorker.name);

  constructor(
    private readonly gatewaySvc: GatewayMensajeriaService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Process({ name: JOBS.NOTIF_ENVIO, concurrency: 5 })
  async procesarNotificacionIndividual(job: Job<PayloadNotifEnvio>): Promise<any> {
    const { telefono, tipo, variables, empresaId, contratoId, clienteId, logId } = job.data;

    if (logId) {
      await this.ds.query(
        `UPDATE notificaciones_logs SET estado_entrega = 'EN_PROCESO'
         WHERE id = $1 AND estado_entrega NOT IN ('ENVIADO','ENTREGADO','LEIDO')`,
        [logId],
      ).catch(() => {});
    }

    const result = await this.gatewaySvc.despachar({
      telefono,
      tipo:      tipo as TipoNotificacion,
      variables,
      empresaId,
      contratoId,
      clienteId,
      logId,
    });

    if (!result.enviado) {
      this.logger.warn(`[Worker] Fallo #${job.id} → ${telefono} (${tipo}): ${result.error}`);
    }
    return result;
  }

  @OnQueueFailed()
  async onFailed(job: Job<PayloadNotifEnvio>, err: Error): Promise<void> {
    const { logId, telefono, tipo } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade >= maxAttempts;

    this.logger.error(
      `[Notificaciones] Job ${job.name}#${job.id} falló ` +
      `(intento ${job.attemptsMade}/${maxAttempts}) → ${telefono} (${tipo}): ${err.message}`,
    );

    if (!logId) return;

    const nuevoEstado = isLastAttempt ? 'FALLIDO' : 'NO_ENVIADO';
    await this.ds.query(
      `UPDATE notificaciones_logs
       SET estado_entrega = $1, error_detalle = $2
       WHERE id = $3 AND estado_entrega NOT IN ('ENVIADO','ENTREGADO','LEIDO')`,
      [nuevoEstado, err.message.substring(0, 500), logId],
    ).catch((dbErr: Error) => {
      this.logger.error(`[Notificaciones] Error actualizando log ${logId} a ${nuevoEstado}: ${dbErr.message}`);
    });
  }
}