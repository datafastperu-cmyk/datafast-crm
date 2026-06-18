import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRouterVpnAndOpenVPN1778900000003 implements MigrationInterface {
  name = 'AddRouterVpnAndOpenVPN1778900000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Enum + columnas VPN/control en routers ─────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'routers_tipo_control_enum') THEN
          CREATE TYPE routers_tipo_control_enum AS ENUM (
            'ninguna', 'amarre_ip_mac', 'amarre_ip_mac_dhcp'
          );
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE routers
        ADD COLUMN IF NOT EXISTS vpn_ip       VARCHAR(50),
        ADD COLUMN IF NOT EXISTS tipo_control routers_tipo_control_enum NOT NULL DEFAULT 'ninguna'
    `);

    // ── 2. Tabla openvpn_config ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS openvpn_config (
        id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id    UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre        VARCHAR(100) NOT NULL DEFAULT 'Servidor VPN',
        servidor_ip   VARCHAR(100) NOT NULL,
        puerto        SMALLINT    NOT NULL DEFAULT 1194,
        protocolo     VARCHAR(10)  NOT NULL DEFAULT 'udp',
        dispositivo   VARCHAR(10)  NOT NULL DEFAULT 'tun',
        vpn_network   VARCHAR(20)  NOT NULL DEFAULT '10.8.0.0',
        vpn_netmask   VARCHAR(20)  NOT NULL DEFAULT '255.255.255.0',
        ca_cert       TEXT,
        server_cert   TEXT,
        server_key    TEXT,
        dh_params     TEXT,
        activo        BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_openvpn_empresa
        ON openvpn_config (empresa_id) WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS openvpn_config CASCADE`);
    await queryRunner.query(`ALTER TABLE routers DROP COLUMN IF EXISTS vpn_ip`);
    await queryRunner.query(`ALTER TABLE routers DROP COLUMN IF EXISTS tipo_control`);
    await queryRunner.query(`DROP TYPE IF EXISTS routers_tipo_control_enum CASCADE`);
  }
}
