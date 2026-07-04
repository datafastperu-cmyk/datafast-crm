import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCbsPbsToTrafficTables1791200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_traffic_tables
        ADD COLUMN IF NOT EXISTS cbs_bytes INTEGER,
        ADD COLUMN IF NOT EXISTS pbs_bytes INTEGER
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_traffic_tables
        DROP COLUMN IF EXISTS cbs_bytes,
        DROP COLUMN IF EXISTS pbs_bytes
    `);
  }
}
