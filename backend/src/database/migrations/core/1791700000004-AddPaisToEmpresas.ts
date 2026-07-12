import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaisToEmpresas1791700000004 implements MigrationInterface {
  name = 'AddPaisToEmpresas1791700000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS pais VARCHAR(2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS pais`);
  }
}
