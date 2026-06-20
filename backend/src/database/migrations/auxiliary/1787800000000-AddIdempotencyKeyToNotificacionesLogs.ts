import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdempotencyKeyToNotificacionesLogs1787800000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE notificaciones_logs
        ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(150);
    `);
    // Índice único parcial: solo indexa filas con key (NULL = evento no idempotente)
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_logs_idempotency_key
        ON notificaciones_logs (idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_notif_logs_idempotency_key`);
    await qr.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS idempotency_key`);
  }
}
