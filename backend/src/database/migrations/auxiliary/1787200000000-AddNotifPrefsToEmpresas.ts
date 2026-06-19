import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotifPrefsToEmpresas1787200000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS notif_bienvenida_activa    BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notif_pago_recibido_activa BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notif_prorroga_activa      BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notif_suspension_activa    BOOLEAN NOT NULL DEFAULT TRUE;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS notif_bienvenida_activa,
        DROP COLUMN IF EXISTS notif_pago_recibido_activa,
        DROP COLUMN IF EXISTS notif_prorroga_activa,
        DROP COLUMN IF EXISTS notif_suspension_activa;
    `);
  }
}
