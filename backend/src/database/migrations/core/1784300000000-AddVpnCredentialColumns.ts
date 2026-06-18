import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVpnCredentialColumns1784300000000 implements MigrationInterface {
  name = 'AddVpnCredentialColumns1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE vpn_clientes
        ADD COLUMN IF NOT EXISTS version_ros          VARCHAR(5)   NOT NULL DEFAULT 'v7',
        ADD COLUMN IF NOT EXISTS vpn_usuario          VARCHAR(100),
        ADD COLUMN IF NOT EXISTS vpn_password_cifrado TEXT,
        ADD COLUMN IF NOT EXISTS cipher               VARCHAR(20)  NOT NULL DEFAULT 'aes256',
        ADD COLUMN IF NOT EXISTS auth_alg             VARCHAR(20)  NOT NULL DEFAULT 'sha1',
        ADD COLUMN IF NOT EXISTS verify_server_cert   BOOLEAN      NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vpn_clientes_vpn_usuario
        ON vpn_clientes (vpn_usuario)
        WHERE vpn_usuario IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_vpn_clientes_vpn_usuario`);
    await queryRunner.query(`
      ALTER TABLE vpn_clientes
        DROP COLUMN IF EXISTS version_ros,
        DROP COLUMN IF EXISTS vpn_usuario,
        DROP COLUMN IF EXISTS vpn_password_cifrado,
        DROP COLUMN IF EXISTS cipher,
        DROP COLUMN IF EXISTS auth_alg,
        DROP COLUMN IF EXISTS verify_server_cert
    `);
  }
}
