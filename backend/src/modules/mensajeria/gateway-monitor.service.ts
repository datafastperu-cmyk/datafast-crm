import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron }         from '@nestjs/schedule';
import { OnEvent }      from '@nestjs/event-emitter';
import { InjectQueue }  from '@nestjs/bull';
import { Queue }        from 'bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }   from 'typeorm';
import { QUEUES, JOBS } from '../workers/workers.constants';
import { GATEWAY_EVENTS } from '../sistema/sistema.service';

const ESTADOS_REINTENTABLES = ['NO_ENVIADO', 'FALLIDO'];
const DELAY_ENTRE_JOBS_MS   = 2_000;
const LOTE_MAX              = 200;

@Injectable()
export class GatewayMonitorService implements OnModuleInit {
  private readonly logger = new Logger(GatewayMonitorService.name);

  private isReconciling = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUES.NOTIFICACIONES) private readonly queue: Queue,
  ) {}

  // Al iniciar: si ya hay proveedor activo + mensajes pendientes → batch retry
  async onModuleInit(): Promise<void> {
    try {
      await this.procesarEmpresasConPendientes('startup');
    } catch (err: any) {
      this.logger.warn(`[Monitor] Error en check de startup: ${err.message}`);
    }
  }

  // Reconciliador periódico: reencola NO_ENVIADO/FALLIDO cada 15 minutos.
  // Cubre el caso donde el proveedor se recuperó sin disparar PROVIDER_ACTIVATED
  // (ej: reinicio del servicio externo, fix manual, circuit breaker reset).
  @Cron('*/15 * * * *', { name: 'notif-reconciler' })
  async reconciliarPendientes(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    if (this.isReconciling) {
      this.logger.warn('[Monitor] Reconciliación en curso — ciclo omitido');
      return;
    }
    this.isReconciling = true;
    try {
      await this.procesarEmpresasConPendientes('cron');
    } catch (err: any) {
      this.logger.error(`[Monitor] Error en reconciliación periódica: ${err.message}`);
    } finally {
      this.isReconciling = false;
    }
  }

  @OnEvent(GATEWAY_EVENTS.PROVIDER_ACTIVATED, { async: true })
  async onProviderActivated(payload: { empresaId: string; proveedor: string }): Promise<void> {
    const { empresaId, proveedor } = payload;
    this.logger.log(`[Monitor] Proveedor ${proveedor} activado — empresa=${empresaId}`);
    try {
      const pendientes = await this.contarPendientes(empresaId);
      if (pendientes === 0) {
        this.logger.log(`[Monitor] Sin mensajes pendientes para empresa ${empresaId}`);
        return;
      }
      this.logger.log(`[Monitor] ${pendientes} mensajes pendientes → batch retry`);
      await this.encolarBatch(empresaId);
    } catch (err: any) {
      this.logger.error(`[Monitor] Error en batch retry empresa=${empresaId}: ${err.message}`);
    }
  }

  // ── Query compartida por startup y cron ───────────────────────────────
  private async procesarEmpresasConPendientes(origen: string): Promise<void> {
    const empresas = await this.ds.query<{ empresa_id: string }[]>(`
      SELECT DISTINCT nl.empresa_id
      FROM notificaciones_logs nl
      JOIN empresas em ON em.id = nl.empresa_id
      WHERE nl.estado_entrega = ANY($1)
        AND nl.empresa_id IS NOT NULL
        AND nl.created_at >= NOW() - INTERVAL '7 days'
        AND em.proveedor_activo IS NOT NULL
        AND (
          (em.proveedor_activo = 'META_GRAPH'                 AND em.meta_graph_activo       = true)
          OR (em.proveedor_activo = 'TWILIO'                  AND em.twilio_activo            = true)
          OR (em.proveedor_activo = 'VONAGE'                  AND em.vonage_activo            = true)
          OR (em.proveedor_activo = 'CUSTOM_API'              AND em.custom_api_activo        = true)
          OR (em.proveedor_activo = 'AUTOMATIZADO_VIP'        AND em.automatizado_vip_activo  = true)
          OR (em.proveedor_activo = 'DATAFAST_MENSAJERIA_MASIVA' AND em.gateway_activo        = true)
        )
    `, [ESTADOS_REINTENTABLES]);

    if (empresas.length === 0) return;

    this.logger.log(`[Monitor][${origen}] ${empresas.length} empresa(s) con mensajes pendientes`);
    for (const { empresa_id } of empresas) {
      const pendientes = await this.contarPendientes(empresa_id);
      if (pendientes > 0) {
        this.logger.log(`[Monitor][${origen}] empresa=${empresa_id} → ${pendientes} pendientes — encolando batch`);
        await this.encolarBatch(empresa_id);
      }
    }
  }

  private async contarPendientes(empresaId: string): Promise<number> {
    const [row] = await this.ds.query<{ total: number }[]>(
      `SELECT COUNT(*)::int AS total FROM notificaciones_logs
       WHERE empresa_id = $1 AND estado_entrega = ANY($2)
         AND created_at >= NOW() - INTERVAL '7 days'`,
      [empresaId, ESTADOS_REINTENTABLES],
    );
    return row?.total ?? 0;
  }

  private async encolarBatch(empresaId: string): Promise<void> {
    const logs = await this.ds.query<{
      id: string; telefono: string; tipo_template: string; contrato_id: string | null;
    }[]>(`
      SELECT id, telefono, tipo_template, contrato_id
      FROM notificaciones_logs
      WHERE empresa_id = $1 AND estado_entrega = ANY($2)
        AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at ASC
      LIMIT $3
    `, [empresaId, ESTADOS_REINTENTABLES, LOTE_MAX]);

    if (logs.length === 0) return;

    let encolados = 0;
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      try {
        await this.queue.add(
          JOBS.NOTIF_ENVIO,
          {
            telefono:   log.telefono,
            tipo:       log.tipo_template,
            variables:  {},
            empresaId,
            contratoId: log.contrato_id ?? undefined,
            logId:      log.id,
          },
          {
            delay:            i * DELAY_ENTRE_JOBS_MS,
            attempts:         3,
            backoff:          { type: 'exponential', delay: 10_000 },
            removeOnComplete: 100,
            removeOnFail:     500,
          },
        );
        // Marcar ENCOLADO solo si Bull aceptó el job
        await this.ds.query(
          `UPDATE notificaciones_logs SET estado_entrega = 'ENCOLADO', error_detalle = NULL WHERE id = $1`,
          [log.id],
        );
        encolados++;
      } catch (err: any) {
        this.logger.error(`[Monitor] Error añadiendo job logId=${log.id}: ${err.message}`);
      }
    }

    this.logger.log(`[Monitor] Batch encolado: ${encolados}/${logs.length} mensajes para empresa ${empresaId} (escalonado ${DELAY_ENTRE_JOBS_MS}ms)`);
  }
}
