import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDiagnosticoToXuiServidores1791700000007 implements MigrationInterface {
  name = 'AddDiagnosticoToXuiServidores1791700000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE xui_servidores
        ADD COLUMN IF NOT EXISTS latencia_ms       INT,
        ADD COLUMN IF NOT EXISTS xui_version        VARCHAR(100),
        ADD COLUMN IF NOT EXISTS hostname          VARCHAR(200),
        ADD COLUMN IF NOT EXISTS api_key_ultimos4   VARCHAR(4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE xui_servidores
        DROP COLUMN IF EXISTS latencia_ms,
        DROP COLUMN IF EXISTS xui_version,
        DROP COLUMN IF EXISTS hostname,
        DROP COLUMN IF EXISTS api_key_ultimos4
    `);
  }
}
