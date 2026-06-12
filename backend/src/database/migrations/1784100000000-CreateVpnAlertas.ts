import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVpnAlertas1784100000000 implements MigrationInterface {
  name = 'CreateVpnAlertas1784100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vpn_alertas (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ,
        version       INTEGER NOT NULL DEFAULT 1,
        empresa_id    VARCHAR(36) NOT NULL,
        cn            VARCHAR(100) NOT NULL,
        router_id     VARCHAR(36),
        router_nombre VARCHAR(200),
        tipo          VARCHAR(30) NOT NULL,
        ip_nueva      VARCHAR(50),
        ip_sesion     VARCHAR(50),
        mensaje       TEXT NOT NULL,
        leida         BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_vpn_alertas_empresa_leida
      ON vpn_alertas (empresa_id, leida)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS vpn_alertas`);
  }
}
