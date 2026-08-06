import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Retención de `auditoria_logs`.
 *
 * La tabla no tenía política de purga y crecía sin límite: 13 MB con 24.670 de 25.776
 * filas (95%) siendo eco de peticiones HTTP que el AuditInterceptor escribe para cada
 * request.
 *
 * **Solo caduca el eco técnico (`tipo = 'http'`).** Los registros de negocio —pagos,
 * cortes, accesos, emisión de comprobantes— NO se borran nunca: son la auditoría del
 * sistema y su valor está justamente en poder consultarlos años después.
 *
 * El borrado va por lotes y no en una sentencia única: un DELETE masivo sobre una tabla
 * viva mantiene el lock más tiempo del que conviene y compite con las escrituras del
 * propio interceptor, que escribe en cada request.
 */
@Injectable()
export class AuditoriaRetencionCron {
  private readonly logger = new Logger(AuditoriaRetencionCron.name);

  /** Días que se conserva el eco de peticiones. El negocio no caduca. */
  private static readonly DIAS_RETENCION_HTTP = 90;
  /** Filas por lote, para no sostener un lock largo sobre una tabla en uso. */
  private static readonly TAMANO_LOTE = 5_000;
  /** Tope por ejecución: si hay millones acumulados, se drena en varias noches. */
  private static readonly LOTES_MAX = 20;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgar(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    // Una sola instancia PM2 purga: varias compitiendo por las mismas filas solo generan
    // contención sobre una tabla que además está recibiendo escrituras.
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;

    const dias = AuditoriaRetencionCron.DIAS_RETENCION_HTTP;
    let borradas = 0;

    try {
      for (let lote = 0; lote < AuditoriaRetencionCron.LOTES_MAX; lote++) {
        const filas = await this.ds.query(
          `DELETE FROM auditoria_logs
            WHERE ctid IN (
              SELECT ctid FROM auditoria_logs
               WHERE tipo = 'http'
                 AND created_at < NOW() - INTERVAL '${dias} days'
               LIMIT ${AuditoriaRetencionCron.TAMANO_LOTE}
            )
          RETURNING 1`,
        );
        const n = Array.isArray(filas) ? filas.length : 0;
        borradas += n;
        if (n < AuditoriaRetencionCron.TAMANO_LOTE) break; // ya no queda nada que purgar
      }

      if (borradas > 0) {
        this.logger.log(
          `Retención auditoría: ${borradas} registros técnicos con más de ${dias} días eliminados`,
        );
      }
    } catch (err) {
      // Que la purga falle no puede tumbar el arranque ni el resto de crons: se reintenta
      // mañana y mientras tanto lo único que pasa es que la tabla ocupa más.
      this.logger.error(
        `Retención auditoría falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
