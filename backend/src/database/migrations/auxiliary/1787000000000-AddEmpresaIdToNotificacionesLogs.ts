import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmpresaIdToNotificacionesLogs1787000000000 implements MigrationInterface {
  name = 'AddEmpresaIdToNotificacionesLogs1787000000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE notificaciones_logs ADD COLUMN IF NOT EXISTS empresa_id UUID NULL;`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_notif_logs_empresa ON notificaciones_logs (empresa_id);`);

    // Backfill: poblar empresa_id desde el contrato vinculado donde sea posible
    await qr.query(`
      UPDATE notificaciones_logs nl
      SET empresa_id = co.empresa_id
      FROM contratos co
      WHERE nl.contrato_id = co.id AND nl.empresa_id IS NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_notif_logs_empresa;`);
    await qr.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS empresa_id;`);
  }
}
