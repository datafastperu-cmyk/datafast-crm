import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent }      from '@nestjs/event-emitter';
import { InjectQueue }  from '@nestjs/bull';
import { Queue }        from 'bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }   from 'typeorm';
import { QUEUES, JOBS } from '../workers/workers.constants';
import { GATEWAY_EVENTS } from '../sistema/sistema.service';

const ESTADOS_REINTENTABLES = ['NO_ENVIADO', 'FALLIDO'];
const DELAY_ENTRE_JOBS_MS   = 2_000; // 2s entre cada mensaje para no saturar el proveedor
const LOTE_MAX              = 200;   // máximo de logs que se reencolan por disparo

@Injectable()
export class GatewayMonitorService implements OnModuleInit {
  private readonly logger = new Logger(GatewayMonitorService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUES.NOTIFICACIONES) private readonly queue: Queue,
  ) {}

  // Al iniciar: si ya hay proveedor activo + mensajes pendientes → batch retry
  async onModuleInit(): Promise<void> {
    try {
      const empresas = await this.ds.query<{ empresa_id: string }[]>(`
        SELECT DISTINCT nl.empresa_id
        FROM notificaciones_logs nl
        JOIN empresas em ON em.id = nl.empresa_id
        WHERE nl.estado_entrega = ANY($1)
          AND nl.empresa_id IS NOT NULL
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

      for (const { empresa_id } of empresas) {
        const pendientes = await this.contarPendientes(empresa_id);
        if (pendientes > 0) {
          this.logger.log(`[Monitor] Startup: ${pendientes} mensajes pendientes para empresa ${empresa_id} — encolando batch`);
          await this.encolarBatch(empresa_id);
        }
      }
    } catch (err: any) {
      this.logger.warn(`[Monitor] Error en check de startup: ${err.message}`);
    }
  }

  @OnEvent(GATEWAY_EVENTS.PROVIDER_ACTIVATED, { async: true })
  async onProviderActivated(payload: { empresaId: string; proveedor: string }): Promise<void> {
    const { empresaId, proveedor } = payload;
    this.logger.log(`[Monitor] Proveedor ${proveedor} activado para empresa ${empresaId} — verificando mensajes pendientes`);
    try {
      const pendientes = await this.contarPendientes(empresaId);
      if (pendientes === 0) {
        this.logger.log(`[Monitor] Sin mensajes pendientes para empresa ${empresaId}`);
        return;
      }
      this.logger.log(`[Monitor] ${pendientes} mensajes NO_ENVIADO/FALLIDO → iniciando batch retry`);
      await this.encolarBatch(empresaId);
    } catch (err: any) {
      this.logger.error(`[Monitor] Error en batch retry para empresa ${empresaId}: ${err.message}`);
    }
  }

  private async contarPendientes(empresaId: string): Promise<number> {
    const [row] = await this.ds.query<{ total: number }[]>(
      `SELECT COUNT(*)::int AS total FROM notificaciones_logs
       WHERE empresa_id = $1 AND estado_entrega = ANY($2)`,
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
      ORDER BY created_at ASC
      LIMIT $3
    `, [empresaId, ESTADOS_REINTENTABLES, LOTE_MAX]);

    if (logs.length === 0) return;

    // Marcar como ENCOLADO antes de añadir a Bull para que /enviados refleje el estado correcto
    const ids = logs.map(l => l.id);
    await this.ds.query(
      `UPDATE notificaciones_logs SET estado_entrega = 'ENCOLADO', error_detalle = NULL
       WHERE id = ANY($1)`,
      [ids],
    );

    // Añadir jobs escalonados para no saturar el proveedor
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
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
          delay:          i * DELAY_ENTRE_JOBS_MS,
          attempts:       3,
          backoff:        { type: 'exponential', delay: 10_000 },
          removeOnComplete: 100,
          removeOnFail:     500,
        },
      );
    }

    this.logger.log(`[Monitor] Batch encolado: ${logs.length} mensajes para empresa ${empresaId} (escalonado ${DELAY_ENTRE_JOBS_MS}ms)`);
  }
}
