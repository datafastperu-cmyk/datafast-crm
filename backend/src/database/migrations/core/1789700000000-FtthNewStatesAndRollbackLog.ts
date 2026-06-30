import { MigrationInterface, QueryRunner } from 'typeorm';

// ALTER TYPE ... ADD VALUE no puede ejecutarse dentro de una transacción
// en PostgreSQL < 14. Marcamos transaction = false para evitar el error.
export class FtthNewStatesAndRollbackLog1789700000000 implements MigrationInterface {
  name = 'FtthNewStatesAndRollbackLog1789700000000';
  transaction = false;

  async up(qr: QueryRunner): Promise<void> {
    // Nuevos estados para ftth_onu_registro
    await qr.query(`ALTER TYPE ftth_onu_estado ADD VALUE IF NOT EXISTS 'timeout_online'`);
    await qr.query(`ALTER TYPE ftth_onu_estado ADD VALUE IF NOT EXISTS 'fallido_service_port'`);
    await qr.query(`ALTER TYPE ftth_onu_estado ADD VALUE IF NOT EXISTS 'suspendido'`);

    // Tabla de log estructurado para cada rollback GPON ejecutado
    await qr.query(`
      CREATE TABLE IF NOT EXISTS ftth_rollback_log (
        id            UUID        NOT NULL DEFAULT gen_random_uuid(),
        empresa_id    UUID        NOT NULL,
        registro_id   UUID        NOT NULL,
        contrato_id   UUID        NOT NULL,
        olt_id        UUID        NOT NULL,
        motivo        VARCHAR(50) NOT NULL,
        estado_previo VARCHAR(30) NOT NULL,
        ssh_exitoso   BOOLEAN     NOT NULL DEFAULT false,
        ssh_error     TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_ftth_rollback_log PRIMARY KEY (id)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_frl_registro  ON ftth_rollback_log(registro_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_frl_empresa   ON ftth_rollback_log(empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_frl_contrato  ON ftth_rollback_log(contrato_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS ftth_rollback_log`);
    // PostgreSQL no soporta DROP VALUE de un enum — los estados quedan
  }
}
