import { MigrationInterface, QueryRunner } from 'typeorm';

export class FtthOnuRegistroAddHealthColumns1790600000000 implements MigrationInterface {
  name = 'FtthOnuRegistroAddHealthColumns1790600000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE ftth_onu_registro
        ADD COLUMN IF NOT EXISTS run_state        VARCHAR(20)   NULL,
        ADD COLUMN IF NOT EXISTS last_online      TIMESTAMPTZ   NULL,
        ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(100)  NULL,
        ADD COLUMN IF NOT EXISTS equipment_id     VARCHAR(100)  NULL,
        ADD COLUMN IF NOT EXISTS uptime_seconds   BIGINT        NULL,
        ADD COLUMN IF NOT EXISTS traffic_table_id INTEGER       NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_ftth_run_state
        ON ftth_onu_registro(olt_id, run_state)
        WHERE deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_ftth_traffic_table
        ON ftth_onu_registro(olt_id, traffic_table_id)
        WHERE deleted_at IS NULL AND traffic_table_id IS NOT NULL
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_ftth_run_state`);
    await qr.query(`DROP INDEX IF EXISTS idx_ftth_traffic_table`);
    await qr.query(`
      ALTER TABLE ftth_onu_registro
        DROP COLUMN IF EXISTS run_state,
        DROP COLUMN IF EXISTS last_online,
        DROP COLUMN IF EXISTS firmware_version,
        DROP COLUMN IF EXISTS equipment_id,
        DROP COLUMN IF EXISTS uptime_seconds,
        DROP COLUMN IF EXISTS traffic_table_id
    `);
  }
}
