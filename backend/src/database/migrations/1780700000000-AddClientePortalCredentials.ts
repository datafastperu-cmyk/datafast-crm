import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientePortalCredentials1780700000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE clientes
        ADD COLUMN IF NOT EXISTS usuario_portal  VARCHAR(50)  NULL,
        ADD COLUMN IF NOT EXISTS password_portal VARCHAR(100) NULL
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE clientes
        DROP COLUMN IF EXISTS usuario_portal,
        DROP COLUMN IF EXISTS password_portal
    `);
  }
}
