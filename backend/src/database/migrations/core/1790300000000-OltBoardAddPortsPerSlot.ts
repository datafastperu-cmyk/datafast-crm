import { MigrationInterface, QueryRunner } from 'typeorm';

export class OltBoardAddPortsPerSlot1790300000000 implements MigrationInterface {
  name = 'OltBoardAddPortsPerSlot1790300000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_boards
        ADD COLUMN IF NOT EXISTS ports_per_slot SMALLINT NULL
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE olt_boards DROP COLUMN IF EXISTS ports_per_slot`);
  }
}
