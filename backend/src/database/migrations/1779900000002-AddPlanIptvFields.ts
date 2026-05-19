import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanIptvFields1779900000002 implements MigrationInterface {
  name = 'AddPlanIptvFields1779900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE planes
        ADD COLUMN IF NOT EXISTS cuenta_iptv   BOOLEAN  NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS sesiones_iptv SMALLINT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE planes DROP COLUMN IF EXISTS cuenta_iptv`);
    await queryRunner.query(`ALTER TABLE planes DROP COLUMN IF EXISTS sesiones_iptv`);
  }
}
