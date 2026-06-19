import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClienteIdToNotificacionesLogs1787600000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE notificaciones_logs
        ADD COLUMN IF NOT EXISTS cliente_id UUID;
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_logs_cliente_id
        ON notificaciones_logs (cliente_id);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_notif_logs_cliente_id`);
    await qr.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS cliente_id`);
  }
}
