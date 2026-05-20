import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubnetsLocalesRouter1780600000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE routers
        ADD COLUMN IF NOT EXISTS subnets_locales json DEFAULT NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE routers DROP COLUMN IF EXISTS subnets_locales;`);
  }
}
