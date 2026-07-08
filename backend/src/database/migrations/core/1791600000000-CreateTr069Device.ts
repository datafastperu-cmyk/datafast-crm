import { MigrationInterface, QueryRunner } from 'typeorm';

// Read-model del estado TR-069 (CPE) de las ONUs, poblado desde GenieACS (NBI).
export class CreateTr069Device1791600000000 implements MigrationInterface {
  name = 'CreateTr069Device1791600000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS tr069_device (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id             UUID NOT NULL,
        genie_id               VARCHAR(200) NOT NULL,
        sn                     VARCHAR(64) NOT NULL,
        oui                    VARCHAR(32),
        product_class          VARCHAR(128),
        software_version       VARCHAR(128),
        connection_request_url TEXT,
        last_inform            TIMESTAMPTZ,
        params                 JSONB NOT NULL DEFAULT '{}',
        snapshot_at            TIMESTAMPTZ NOT NULL,
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_tr069_empresa ON tr069_device (empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_tr069_sn ON tr069_device (sn)`);
    await qr.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tr069_genie ON tr069_device (empresa_id, genie_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS tr069_device`);
  }
}
