import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMasivaFlagsToEmpresas1782600000000 implements MigrationInterface {
  name = 'AddMasivaFlagsToEmpresas1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
      ADD COLUMN IF NOT EXISTS gateway_masiva_nombre_operador BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
      DROP COLUMN IF EXISTS gateway_masiva_nombre_operador
    `);
  }
}
