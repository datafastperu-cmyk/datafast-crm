import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSentAtToNotificacionesLogs1787300000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE notificaciones_logs
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL;
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_logs_sent_at
        ON notificaciones_logs (sent_at) WHERE sent_at IS NOT NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_notif_logs_sent_at;`);
    await qr.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS sent_at;`);
  }
}
