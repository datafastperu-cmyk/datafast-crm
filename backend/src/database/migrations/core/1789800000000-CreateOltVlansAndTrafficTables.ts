import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOltVlansAndTrafficTables1789800000000 implements MigrationInterface {
  name = 'CreateOltVlansAndTrafficTables1789800000000';

  async up(qr: QueryRunner): Promise<void> {
    // VLANs configuradas por OLT (cargadas manualmente o sincronizadas desde la OLT)
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_vlans (
        id          UUID        NOT NULL DEFAULT gen_random_uuid(),
        empresa_id  UUID        NOT NULL,
        olt_id      UUID        NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        vlan_id     INT         NOT NULL,
        nombre      VARCHAR(64) NOT NULL,
        descripcion TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_olt_vlans PRIMARY KEY (id),
        CONSTRAINT uq_olt_vlan_id UNIQUE (olt_id, vlan_id)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_vlans_empresa ON olt_vlans(empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_vlans_olt    ON olt_vlans(olt_id)`);

    // Traffic tables / perfiles de velocidad por OLT
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_traffic_tables (
        id          UUID        NOT NULL DEFAULT gen_random_uuid(),
        empresa_id  UUID        NOT NULL,
        olt_id      UUID        NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        traffic_id  INT         NOT NULL,
        nombre      VARCHAR(64) NOT NULL,
        cir_kbps    INT,
        pir_kbps    INT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_olt_traffic_tables PRIMARY KEY (id),
        CONSTRAINT uq_olt_traffic_id UNIQUE (olt_id, traffic_id)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_tt_empresa ON olt_traffic_tables(empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_tt_olt     ON olt_traffic_tables(olt_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS olt_traffic_tables`);
    await qr.query(`DROP TABLE IF EXISTS olt_vlans`);
  }
}
