import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanMikrotikFields1779900000001 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE planes
        ADD COLUMN IF NOT EXISTS prioridad     SMALLINT NOT NULL DEFAULT 8,
        ADD COLUMN IF NOT EXISTS addresslist   VARCHAR(100),
        ADD COLUMN IF NOT EXISTS burst_umbral  SMALLINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS burst_tiempo  SMALLINT NOT NULL DEFAULT 0
    `);
    // burst_tiempo may already exist — ignore duplicate error
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE planes
        DROP COLUMN IF EXISTS prioridad,
        DROP COLUMN IF EXISTS addresslist,
        DROP COLUMN IF EXISTS burst_umbral
    `);
  }
}
