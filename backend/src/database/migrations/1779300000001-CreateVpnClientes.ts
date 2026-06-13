import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVpnClientes1779300000001 implements MigrationInterface {
  name = 'CreateVpnClientes1779300000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vpn_clientes (
        id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
        empresa_id            VARCHAR(36)  NOT NULL,
        usuario_id            VARCHAR(36),
        nombre                VARCHAR(100) NOT NULL,
        ubicacion             VARCHAR(200),
        descripcion           TEXT,
        nombre_cert           VARCHAR(100) NOT NULL,
        version_ros           VARCHAR(5)   NOT NULL DEFAULT 'v7',
        vpn_usuario           VARCHAR(100),
        vpn_password_cifrado  TEXT,
        cipher                VARCHAR(20)  NOT NULL DEFAULT 'aes256',
        auth_alg              VARCHAR(20)  NOT NULL DEFAULT 'sha1',
        verify_server_cert    BOOLEAN      NOT NULL DEFAULT false,
        estado                VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
        vpn_ip                VARCHAR(20),
        router_id             VARCHAR(36),
        token_descarga        VARCHAR(64)  NOT NULL,
        token_expires_at      TIMESTAMPTZ  NOT NULL,
        ultimo_handshake      TIMESTAMPTZ,
        ip_real               VARCHAR(50),
        activo                BOOLEAN      NOT NULL DEFAULT true,
        script_generado       TEXT,
        version               INTEGER      NOT NULL DEFAULT 1,
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
        deleted_at            TIMESTAMPTZ,
        CONSTRAINT pk_vpn_clientes         PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_vpn_clientes_nombre_cert
        ON vpn_clientes (nombre_cert)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vpn_clientes_vpn_usuario
        ON vpn_clientes (vpn_usuario)
        WHERE vpn_usuario IS NOT NULL AND deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_vpn_clientes_empresa
        ON vpn_clientes (empresa_id, activo)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_vpn_clientes_token
        ON vpn_clientes (token_descarga)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_vpn_clientes_estado
        ON vpn_clientes (estado)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS vpn_clientes`);
  }
}
