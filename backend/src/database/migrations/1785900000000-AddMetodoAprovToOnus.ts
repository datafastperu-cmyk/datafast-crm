import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetodoAprovToOnus1785900000000 implements MigrationInterface {
  name = 'AddMetodoAprovToOnus1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onus
        ADD COLUMN IF NOT EXISTS metodo_aprovisionamiento VARCHAR(20)
          NOT NULL DEFAULT 'smartolt'
          CHECK (metodo_aprovisionamiento IN ('smartolt', 'nativo_ssh', 'nativo_snmp'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onus DROP COLUMN IF EXISTS metodo_aprovisionamiento
    `);
  }
}
