import { Injectable, Logger } from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job }                              from 'bull';
import { GatewayMensajeriaService }         from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }                 from '../notificaciones/services/whatsapp.service';
import { QUEUES, JOBS, PayloadCampanaItem } from '../workers/workers.constants';
import { ResultadoOperacion, esExito, mensajeDe } from '../../common/domain/resultado-operacion';

// ─── Cola CAMPANAS: mensajes masivos con goteo ─────────────────
// Separada de NOTIFICACIONES para que las alertas críticas del sistema
// (suspensiones, pagos, alertas de red) nunca queden bloqueadas detrás
// de un lote de 500 mensajes de campaña.
@Processor(QUEUES.CAMPANAS)
@Injectable()
export class CampanasWorker {
  private readonly logger = new Logger(CampanasWorker.name);

  constructor(
    private readonly gatewaySvc: GatewayMensajeriaService,
  ) {}

  @Process({ name: JOBS.CAMPANA_MASIVA, concurrency: 1 })
  async procesarCampanaMasiva(job: Job<PayloadCampanaItem>): Promise<ResultadoOperacion> {
    const { empresaId, tipo, telefono, variables } = job.data;

    const result = await this.gatewaySvc.despachar({
      telefono,
      tipo:      tipo as TipoNotificacion,
      variables,
      empresaId,
    });

    if (esExito(result)) return result;

    if (result.clase === 'rechazado_definitivo') {
      this.logger.warn(`[CampanasWorker] Rechazo definitivo job #${job.id} → ${telefono}: ${result.motivo}`);
      return result;
    }

    this.logger.warn(`[CampanasWorker] Fallo job #${job.id} → ${telefono} [${result.clase}]: ${mensajeDe(result)}`);
    throw new Error(mensajeDe(result));
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `[Campanas] Job ${job.name}#${job.id} falló ` +
      `(intento ${job.attemptsMade}): ${err.message}`,
    );
  }
}
