import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropNotifWhatsappColumnsFromEmpresas1787400000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS notif_whatsapp_vencimiento,
        DROP COLUMN IF EXISTS notif_whatsapp_corte;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS notif_whatsapp_vencimiento BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notif_whatsapp_corte BOOLEAN NOT NULL DEFAULT TRUE;
    `);
  }
}
