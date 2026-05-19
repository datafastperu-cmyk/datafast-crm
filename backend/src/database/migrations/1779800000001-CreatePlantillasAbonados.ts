import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlantillasAbonados1779800000001 implements MigrationInterface {
  name = 'CreatePlantillasAbonados1779800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE plantillas_abonados (
        id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id     UUID         NOT NULL,
        nombre         VARCHAR(150) NOT NULL,
        facturacion    JSONB        NOT NULL DEFAULT '{}',
        notificaciones JSONB        NOT NULL DEFAULT '{}',
        es_default     BOOLEAN      NOT NULL DEFAULT false,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_plantillas_abonados_empresa ON plantillas_abonados (empresa_id)
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_plantillas_abonados
        BEFORE UPDATE ON plantillas_abonados
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS set_updated_at_plantillas_abonados ON plantillas_abonados`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_plantillas_abonados_empresa`);
    await queryRunner.query(`DROP TABLE IF EXISTS plantillas_abonados CASCADE`);
  }
}
