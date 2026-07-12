import { MigrationInterface, QueryRunner } from 'typeorm';

// Gestión de credenciales de acceso admin de la ONU por TR-069 (capability onu_admin_credentials).
//   onu_admin_user     = login admin de la ONU (texto; no es secreto)
//   onu_admin_password = contraseña admin (CIFRADA por la capa de servicio)
export class AddOnuAdminCredsToContratoOnuConfig1791700000007 implements MigrationInterface {
  name = 'AddOnuAdminCredsToContratoOnuConfig1791700000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        ADD COLUMN IF NOT EXISTS onu_admin_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS onu_admin_user     VARCHAR(64),
        ADD COLUMN IF NOT EXISTS onu_admin_password TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        DROP COLUMN IF EXISTS onu_admin_enabled,
        DROP COLUMN IF EXISTS onu_admin_user,
        DROP COLUMN IF EXISTS onu_admin_password;
    `);
  }
}
