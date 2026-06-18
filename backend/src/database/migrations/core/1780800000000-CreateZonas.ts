import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateZonas1780800000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS zonas (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id   UUID NOT NULL,
        nombre       VARCHAR(100) NOT NULL,
        activo       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_zonas_empresa ON zonas(empresa_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS zonas`);
  }
}
