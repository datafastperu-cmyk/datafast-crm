import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsuarioIdToVpnClientes1783100000000 implements MigrationInterface {
  name = 'AddUsuarioIdToVpnClientes1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vpn_clientes
        ADD COLUMN IF NOT EXISTS usuario_id VARCHAR(36) NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_vpn_clientes_usuario_id
        ON vpn_clientes (usuario_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_vpn_clientes_usuario_id`);
    await queryRunner.query(`ALTER TABLE vpn_clientes DROP COLUMN IF EXISTS usuario_id`);
  }
}
