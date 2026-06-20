import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmtpToProveedorEnum1787900000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TYPE proveedor_mensajeria ADD VALUE IF NOT EXISTS 'SMTP'`);
    await qr.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS smtp_activo      BOOLEAN      NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS smtp_host        VARCHAR(255),
        ADD COLUMN IF NOT EXISTS smtp_port        INTEGER      NOT NULL DEFAULT 587,
        ADD COLUMN IF NOT EXISTS smtp_usuario     VARCHAR(255),
        ADD COLUMN IF NOT EXISTS smtp_clave       TEXT,
        ADD COLUMN IF NOT EXISTS smtp_from_name   VARCHAR(255),
        ADD COLUMN IF NOT EXISTS smtp_from_email  VARCHAR(255);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS smtp_activo,
        DROP COLUMN IF EXISTS smtp_host,
        DROP COLUMN IF EXISTS smtp_port,
        DROP COLUMN IF EXISTS smtp_usuario,
        DROP COLUMN IF EXISTS smtp_clave,
        DROP COLUMN IF EXISTS smtp_from_name,
        DROP COLUMN IF EXISTS smtp_from_email;
    `);
  }
}
