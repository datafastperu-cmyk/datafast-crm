import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScriptOriginalToVpnClientes1781000000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE vpn_clientes
      ADD COLUMN IF NOT EXISTS script_original TEXT NULL
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE vpn_clientes DROP COLUMN IF EXISTS script_original
    `);
  }
}
