import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabla saga_log: registro persistente de cada operación multi-paso (Saga Pattern).
 * Permite detectar sagas abandonadas, auditar compensaciones y diagnosticar fallos parciales.
 *
 * Estados del ciclo de vida:
 *   running             → en ejecución
 *   completed           → todos los pasos OK
 *   failed              → falló sin iniciar compensación
 *   compensating        → revirtiendo pasos completados
 *   compensation_failed → compensación también falló — requiere intervención manual
 */
export class CreateSagaLog1788100000000 implements MigrationInterface {
  name = 'CreateSagaLog1788100000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE saga_log (
        id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        saga_tipo      VARCHAR(50) NOT NULL,
        contrato_id    UUID        NOT NULL,
        empresa_id     UUID        NOT NULL,
        status         VARCHAR(30) NOT NULL DEFAULT 'running',
        paso_actual    SMALLINT    NOT NULL DEFAULT 0,
        pasos_totales  SMALLINT    NOT NULL,
        pasos          JSONB       NOT NULL DEFAULT '[]',
        actor_id       UUID,
        trace_id       VARCHAR(100),
        error          TEXT,
        iniciado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completado_en  TIMESTAMPTZ
      )
    `);

    await qr.query(`CREATE INDEX idx_saga_running   ON saga_log (status, iniciado_en) WHERE status = 'running'`);
    await qr.query(`CREATE INDEX idx_saga_comp_fail ON saga_log (status)              WHERE status = 'compensation_failed'`);
    await qr.query(`CREATE INDEX idx_saga_contrato  ON saga_log (contrato_id, iniciado_en DESC)`);
    await qr.query(`CREATE INDEX idx_saga_empresa   ON saga_log (empresa_id, status)`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS saga_log`);
  }
}
