import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTipoAuthToContratos1784700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE contratos
        ADD COLUMN IF NOT EXISTS tipo_auth VARCHAR(20) NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE contratos DROP COLUMN IF EXISTS tipo_auth`);
  }
}
