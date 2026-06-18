import { Injectable, Logger } from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job }                              from 'bull';
import { GatewayMensajeriaService }         from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }                 from '../notificaciones/services/whatsapp.service';
import { QUEUES, JOBS, PayloadCampanaItem } from '../workers/workers.constants';

// ─── Payload unificado de llegada desde el listener ──────────
interface PayloadNotifEnvio {
  telefono:    string;
  tipo:        string;
  variables:   Record<string, string>;
  empresaId?:  string;
  contratoId?: string;
  clienteId?:  string;
  logId?:      string;   // creado por NotificationEventListener al encolar
}

@Processor(QUEUES.NOTIFICACIONES)
@Injectable()
export class MensajeriaWorker {
  private readonly logger = new Logger(MensajeriaWorker.name);

  constructor(
    private readonly gatewaySvc: GatewayMensajeriaService,
  ) {}

  // ── Campañas masivas (con goteo) ────────────────────────────
  @Process({ name: JOBS.CAMPANA_MASIVA, concurrency: 1 })
  async procesarCampanaMasiva(job: Job<PayloadCampanaItem>): Promise<any> {
    const { empresaId, tipo, telefono, variables } = job.data;
    const result = await this.gatewaySvc.despachar({
      telefono,
      tipo:      tipo as TipoNotificacion,
      variables,
      empresaId,
    });
    if (!result.enviado) {
      this.logger.warn(`[MensajeriaWorker] Fallo job #${job.id} → ${telefono}: ${result.error}`);
    }
    return result;
  }

  // ── Notificaciones individuales (desde eventos del sistema) ─
  @Process({ name: JOBS.NOTIF_ENVIO, concurrency: 5 })
  async procesarNotificacionIndividual(job: Job<PayloadNotifEnvio>): Promise<any> {
    const { telefono, tipo, variables, empresaId, contratoId, clienteId, logId } = job.data;

    // El log ya fue creado como ENCOLADO por NotificationEventListener.
    // El gateway actualizará el estado a ENVIADO | NO_ENVIADO | FALLIDO.
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
      this.logger.warn(
        `[Worker] Fallo #${job.id} → ${telefono} (${tipo}): ${result.error}`,
      );
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