import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddControlaAutenticacionToRouters1783500000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE routers
      ADD COLUMN IF NOT EXISTS controla_autenticacion BOOLEAN NOT NULL DEFAULT TRUE
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE routers DROP COLUMN IF EXISTS controla_autenticacion`);
  }
}
