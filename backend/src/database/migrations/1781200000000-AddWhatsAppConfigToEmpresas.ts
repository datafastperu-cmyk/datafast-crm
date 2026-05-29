import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsAppConfigToEmpresas1781200000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS whatsapp_token       TEXT        NULL,
        ADD COLUMN IF NOT EXISTS whatsapp_phone_id    VARCHAR(60) NULL,
        ADD COLUMN IF NOT EXISTS whatsapp_business_id VARCHAR(60) NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS whatsapp_token,
        DROP COLUMN IF EXISTS whatsapp_phone_id,
        DROP COLUMN IF EXISTS whatsapp_business_id;
    `);
  }
}
