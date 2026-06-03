import { Injectable, Logger }               from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job }                               from 'bull';

import { GatewayMensajeriaService }          from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }                  from '../notificaciones/services/whatsapp.service';
import { QUEUES, JOBS, PayloadCampanaItem }  from '../workers/workers.constants';

@Processor(QUEUES.NOTIFICACIONES)
@Injectable()
export class MensajeriaWorker {
  private readonly logger = new Logger(MensajeriaWorker.name);

  constructor(private readonly gatewaySvc: GatewayMensajeriaService) {}

  // concurrency=1 — respeta el goteo; no procesar en paralelo
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
      this.logger.warn(
        `[MensajeriaWorker] Fallo job #${job.id} → ${telefono}: ${result.error}`,
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
