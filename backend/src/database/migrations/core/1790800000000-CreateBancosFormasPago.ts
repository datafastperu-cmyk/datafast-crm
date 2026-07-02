import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBancosFormasPago1790800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bancos_isp (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id  UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre      VARCHAR(100) NOT NULL,
        es_protegido BOOLEAN    NOT NULL DEFAULT false,
        activo      BOOLEAN     NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ NULL,
        version     INT         NOT NULL DEFAULT 1
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_bancos_isp_empresa
        ON bancos_isp (empresa_id) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS formas_pago_isp (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id  UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre      VARCHAR(100) NOT NULL,
        es_protegido BOOLEAN    NOT NULL DEFAULT false,
        activo      BOOLEAN     NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ NULL,
        version     INT         NOT NULL DEFAULT 1
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_formas_pago_isp_empresa
        ON formas_pago_isp (empresa_id) WHERE deleted_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS formas_pago_isp`);
    await queryRunner.query(`DROP TABLE IF EXISTS bancos_isp`);
  }
}
