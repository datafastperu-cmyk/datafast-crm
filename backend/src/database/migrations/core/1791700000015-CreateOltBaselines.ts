import { MigrationInterface, QueryRunner } from 'typeorm';

// Incremento 8 — Baseline versionado (DISP). Tabla de baselines declarativos
// + FK débil baseline_id en olt_dispositivos (nullable: OLT sin baseline
// asignado = reglas de baseline no aplican). Migración aditiva.
export class CreateOltBaselines1791700000015 implements MigrationInterface {
  name = 'CreateOltBaselines1791700000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS olt_baselines (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id  UUID NOT NULL,
        nombre      VARCHAR(100) NOT NULL,
        version     INT NOT NULL DEFAULT 1,
        descripcion TEXT,
        spec        JSONB NOT NULL,
        activo      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_olt_baselines_empresa ON olt_baselines (empresa_id);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_olt_baseline_nombre_version
        ON olt_baselines (empresa_id, nombre, version);
    `);
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos ADD COLUMN IF NOT EXISTS baseline_id UUID;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE olt_dispositivos DROP COLUMN IF EXISTS baseline_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS olt_baselines;`);
  }
}
