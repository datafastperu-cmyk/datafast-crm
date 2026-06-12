import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVpnCommonNameToRouters1784000000000 implements MigrationInterface {
  name = 'AddVpnCommonNameToRouters1784000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE routers
      ADD COLUMN IF NOT EXISTS vpn_common_name VARCHAR(100),
      ADD CONSTRAINT IF NOT EXISTS uq_routers_vpn_common_name UNIQUE (vpn_common_name)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE routers
      DROP CONSTRAINT IF EXISTS uq_routers_vpn_common_name,
      DROP COLUMN IF EXISTS vpn_common_name
    `);
  }
}
