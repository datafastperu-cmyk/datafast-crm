import { Injectable, Logger } from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job }                              from 'bull';
import { GatewayMensajeriaService }         from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }                 from '../notificaciones/services/whatsapp.service';
import { QUEUES, JOBS }                     from '../workers/workers.constants';

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
  ) {}

  @Process({ name: JOBS.NOTIF_ENVIO, concurrency: 5 })
  async procesarNotificacionIndividual(job: Job<PayloadNotifEnvio>): Promise<any> {
    const { telefono, tipo, variables, empresaId, contratoId, clienteId, logId } = job.data;

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
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `[Notificaciones] Job ${job.name}#${job.id} falló ` +
      `(intento ${job.attemptsMade}): ${err.message}`,
    );
  }
}