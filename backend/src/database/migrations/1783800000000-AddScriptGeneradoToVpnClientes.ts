import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScriptGeneradoToVpnClientes1783800000000 implements MigrationInterface {
  name = 'AddScriptGeneradoToVpnClientes1783800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vpn_clientes
        ADD COLUMN IF NOT EXISTS script_generado TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vpn_clientes DROP COLUMN IF EXISTS script_generado
    `);
  }
}
