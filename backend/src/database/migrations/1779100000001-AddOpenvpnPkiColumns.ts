import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpenvpnPkiColumns1779100000001 implements MigrationInterface {
  name = 'AddOpenvpnPkiColumns1779100000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE openvpn_config
        ADD COLUMN IF NOT EXISTS ta_key        TEXT,
        ADD COLUMN IF NOT EXISTS installed_at  TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ca_expiry     VARCHAR(100),
        ADD COLUMN IF NOT EXISTS server_expiry VARCHAR(100)
    `);

    // Corregir default de protocolo a tcp (compatible con RouterOS 6.x)
    await queryRunner.query(`
      ALTER TABLE openvpn_config
        ALTER COLUMN protocolo SET DEFAULT 'tcp'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE openvpn_config
        DROP COLUMN IF EXISTS ta_key,
        DROP COLUMN IF EXISTS installed_at,
        DROP COLUMN IF EXISTS ca_expiry,
        DROP COLUMN IF EXISTS server_expiry
    `);
    await queryRunner.query(`
      ALTER TABLE openvpn_config
        ALTER COLUMN protocolo SET DEFAULT 'udp'
    `);
  }
}
