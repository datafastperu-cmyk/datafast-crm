import { Injectable, Logger, Inject } from '@nestjs/common';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { InjectDataSource }                 from '@nestjs/typeorm';
import { DataSource }                       from 'typeorm';
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
}

@Processor(QUEUES.NOTIFICACIONES)
@Injectable()
export class MensajeriaWorker {
  private readonly logger = new Logger(MensajeriaWorker.name);

  constructor(
    private readonly gatewaySvc: GatewayMensajeriaService,
    @InjectDataSource() private readonly ds: DataSource,
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
    const { telefono, tipo, variables, empresaId, contratoId, clienteId } = job.data;

    // 1. Crear log con estado EN_PROCESO
    let logId: string | null = null;
    try {
      const [row] = await this.ds.query(`
        INSERT INTO notificaciones_logs (contrato_id, telefono, tipo_template, estado_entrega)
        VALUES ($1, $2, $3, 'EN_PROCESO') RETURNING id
      `, [contratoId ?? null, telefono.substring(0, 30), tipo]);
      logId = row?.id ?? null;
    } catch (logErr: any) {
      this.logger.warn(`[Worker] No se pudo crear log: ${logErr.message}`);
    }

    // 2. Despachar vía gateway
    const result = await this.gatewaySvc.despachar({
      telefono,
      tipo:      tipo as TipoNotificacion,
      variables,
      empresaId,
      contratoId,
      clienteId,
    });

    // 3. Actualizar log con resultado final
    if (logId) {
      try {
        if (result.enviado) {
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'ENVIADO_META', meta_message_id = $1 WHERE id = $2`,
            [result.messageId ?? null, logId],
          );
        } else {
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'FALLIDO', error_detalle = $1 WHERE id = $2`,
            [(result.error ?? 'Error desconocido').substring(0, 500), logId],
          );
        }
      } catch (logErr: any) {
        this.logger.warn(`[Worker] No se pudo actualizar log ${logId}: ${logErr.message}`);
      }
    }

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