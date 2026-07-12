import { MigrationInterface, QueryRunner } from 'typeorm';

// Cuentas adicionales de acceso de la ONU (además de la admin): usuario web + root CLI.
//   onu_webuser_user/password = cuenta usuario web limitada (X_HW_WebUserInfo.1)
//   onu_cli_user/password     = cuenta root CLI/Telnet (X_HW_CLIUserInfo.1)
// Las contraseñas van CIFRADAS por la capa de servicio.
export class AddOnuWebCliCredsToContratoOnuConfig1791700000008 implements MigrationInterface {
  name = 'AddOnuWebCliCredsToContratoOnuConfig1791700000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        ADD COLUMN IF NOT EXISTS onu_webuser_user     VARCHAR(64),
        ADD COLUMN IF NOT EXISTS onu_webuser_password TEXT,
        ADD COLUMN IF NOT EXISTS onu_cli_user         VARCHAR(64),
        ADD COLUMN IF NOT EXISTS onu_cli_password     TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        DROP COLUMN IF EXISTS onu_webuser_user,
        DROP COLUMN IF EXISTS onu_webuser_password,
        DROP COLUMN IF EXISTS onu_cli_user,
        DROP COLUMN IF EXISTS onu_cli_password;
    `);
  }
}
