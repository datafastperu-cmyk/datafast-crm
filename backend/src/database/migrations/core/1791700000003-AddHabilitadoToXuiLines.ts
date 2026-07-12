import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHabilitadoToXuiLines1791700000003 implements MigrationInterface {
  name = 'AddHabilitadoToXuiLines1791700000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE xui_lines
        ADD COLUMN IF NOT EXISTS habilitado BOOLEAN NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE xui_lines DROP COLUMN IF EXISTS habilitado`);
  }
}
