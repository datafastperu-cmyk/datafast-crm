import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMigracionFlagsToContratos1786000000000 implements MigrationInterface {
  name = 'AddMigracionFlagsToContratos1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        ADD COLUMN IF NOT EXISTS en_migracion          BOOLEAN     NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS migracion_iniciada_en TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        DROP COLUMN IF EXISTS en_migracion,
        DROP COLUMN IF EXISTS migracion_iniciada_en
    `);
  }
}
