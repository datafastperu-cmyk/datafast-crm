import { MigrationInterface, QueryRunner } from 'typeorm';

export class OltTrafficTableAddTipoOrigenEstado1790500000000 implements MigrationInterface {
  name = 'OltTrafficTableAddTipoOrigenEstado1790500000000';

  async up(qr: QueryRunner): Promise<void> {
    // tipo: 'upstream' | 'downstream' | 'combinado'
    // origen: 'olt' = sincronizada desde hardware, 'erp' = creada desde el ERP
    // estado: 'active' | 'syncing' | 'error'
    await qr.query(`
      ALTER TABLE olt_traffic_tables
        ADD COLUMN IF NOT EXISTS tipo   VARCHAR(20) NOT NULL DEFAULT 'combinado',
        ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'olt',
        ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'active'
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_olt_tt_tipo   ON olt_traffic_tables(olt_id, tipo)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_olt_tt_estado ON olt_traffic_tables(olt_id, estado)
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_olt_tt_tipo`);
    await qr.query(`DROP INDEX IF EXISTS idx_olt_tt_estado`);
    await qr.query(`ALTER TABLE olt_traffic_tables DROP COLUMN IF EXISTS tipo`);
    await qr.query(`ALTER TABLE olt_traffic_tables DROP COLUMN IF EXISTS origen`);
    await qr.query(`ALTER TABLE olt_traffic_tables DROP COLUMN IF EXISTS estado`);
  }
}
