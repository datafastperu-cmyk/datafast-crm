import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea la tabla reconciliation_log para auditar cada ciclo del reconciliador.
 * Se inserta un registro por ciclo con el número de contratos procesados,
 * correcciones aplicadas, errores y duración del ciclo.
 */
export class CreateReconciliationLog1788300000000 implements MigrationInterface {
  name = 'CreateReconciliationLog1788300000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_log (
        id            BIGSERIAL    PRIMARY KEY,
        procesados    INTEGER      NOT NULL DEFAULT 0,
        correcciones  INTEGER      NOT NULL DEFAULT 0,
        errores       JSONB        NOT NULL DEFAULT '[]',
        duracion_ms   INTEGER      NOT NULL DEFAULT 0,
        ejecutado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // Solo retener 30 días de historial; el índice agiliza el purge y las consultas de monitoreo
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_reconciliation_log_ejecutado_en
        ON reconciliation_log (ejecutado_en DESC)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX  IF EXISTS idx_reconciliation_log_ejecutado_en`);
    await qr.query(`DROP TABLE  IF EXISTS reconciliation_log`);
  }
}
