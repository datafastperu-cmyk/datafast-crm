import { MigrationInterface, QueryRunner } from 'typeorm';

export class OltVlanAddOrigenEstado1790400000000 implements MigrationInterface {
  name = 'OltVlanAddOrigenEstado1790400000000';

  async up(qr: QueryRunner): Promise<void> {
    // origen: 'erp' = creada desde el ERP, 'olt' = importada desde el hardware
    await qr.query(`
      ALTER TABLE olt_vlans
        ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'erp',
        ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'active'
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_olt_vlans_estado ON olt_vlans(olt_id, estado)
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_olt_vlans_estado`);
    await qr.query(`ALTER TABLE olt_vlans DROP COLUMN IF EXISTS origen`);
    await qr.query(`ALTER TABLE olt_vlans DROP COLUMN IF EXISTS estado`);
  }
}
