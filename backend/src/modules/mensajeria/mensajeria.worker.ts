import { Injectable, Logger } from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job }                               from 'bull';
import { InjectDataSource }                  from '@nestjs/typeorm';
import { DataSource }                        from 'typeorm';
import { GatewayMensajeriaService }          from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }                  from '../notificaciones/services/whatsapp.service';
import { QUEUES, JOBS }                      from '../workers/workers.constants';
import { ResultadoOperacion, esExito, mensajeDe } from '../../common/domain/resultado-operacion';

// ─── Payload unificado de llegada desde NotificationEventListener ─
interface PayloadNotifEnvio {
  telefono:    string;
  tipo:        string;
  /** Override del código de plantilla elegido por el abonado. */
  codigoPlantilla?: string;
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
  async procesarNotificacionIndividual(job: Job<PayloadNotifEnvio>): Promise<ResultadoOperacion> {
    const { telefono, tipo, variables, empresaId, contratoId, clienteId, logId, codigoPlantilla } = job.data;

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
      codigoPlantilla,
      variables,
      empresaId,
      contratoId,
      clienteId,
      logId,
    });

    if (esExito(result)) return result;

    // `rechazado_definitivo`: BullMQ NO debe reintentar — el veredicto no cambia. Se
    // registra y se devuelve tal cual (D-14: detener y escalar, no martillar).
    if (result.clase === 'rechazado_definitivo') {
      this.logger.warn(`[Worker] Rechazo definitivo #${job.id} → ${telefono} (${tipo}): ${result.motivo}`);
      return result;
    }

    // `reintentable` / `indeterminado`: lanzar para que el `attempts`+backoff ya
    // configurado en JOB_OPTIONS (workers.constants.ts) intervenga de verdad — antes
    // este handler nunca lanzaba y esos reintentos llevaban configurados sin ejecutarse.
    this.logger.warn(`[Worker] Fallo #${job.id} → ${telefono} (${tipo}) [${result.clase}]: ${mensajeDe(result)}`);
    throw new Error(mensajeDe(result));
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