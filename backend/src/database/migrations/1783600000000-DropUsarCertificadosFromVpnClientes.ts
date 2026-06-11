import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropUsarCertificadosFromVpnClientes1783600000000 implements MigrationInterface {
  name = 'DropUsarCertificadosFromVpnClientes1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vpn_clientes DROP COLUMN IF EXISTS usar_certificados
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vpn_clientes
        ADD COLUMN IF NOT EXISTS usar_certificados BOOLEAN NOT NULL DEFAULT false
    `);
  }
}
