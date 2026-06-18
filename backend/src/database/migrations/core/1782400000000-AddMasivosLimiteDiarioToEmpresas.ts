import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMasivosLimiteDiarioToEmpresas1782400000000 implements MigrationInterface {
  name = 'AddMasivosLimiteDiarioToEmpresas1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
      ADD COLUMN IF NOT EXISTS gateway_masivo_limite_diario INT NOT NULL DEFAULT 500
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
      DROP COLUMN IF EXISTS gateway_masivo_limite_diario
    `);
  }
}
