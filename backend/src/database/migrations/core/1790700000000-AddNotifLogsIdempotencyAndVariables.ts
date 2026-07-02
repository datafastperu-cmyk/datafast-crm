import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotifLogsIdempotencyAndVariables1790700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Columna para clave de idempotencia (evita duplicados entre pagos.service y cobranza.worker)
    await queryRunner.query(`
      ALTER TABLE notificaciones_logs
        ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200) NULL
    `);

    // Índice parcial único — la constraint ON CONFLICT (idempotency_key) lo requiere
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_logs_idempotency
        ON notificaciones_logs (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

    // Columna JSONB con las variables de plantilla almacenadas al encolar
    await queryRunner.query(`
      ALTER TABLE notificaciones_logs
        ADD COLUMN IF NOT EXISTS variables JSONB NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_notif_logs_idempotency`);
    await queryRunner.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS idempotency_key`);
    await queryRunner.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS variables`);
  }
}
