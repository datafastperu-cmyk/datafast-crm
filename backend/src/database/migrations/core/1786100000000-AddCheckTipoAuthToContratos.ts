import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckTipoAuthToContratos1786100000000 implements MigrationInterface {
  name = 'AddCheckTipoAuthToContratos1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Limpiar cualquier valor fuera del enum antes de agregar el constraint
    // NULL permanece válido — contratos sin autenticación definida
    await queryRunner.query(`
      UPDATE contratos
        SET tipo_auth = NULL
      WHERE tipo_auth IS NOT NULL
        AND tipo_auth NOT IN ('pppoe', 'amarre_ip_mac', 'amarre_ip_mac_dhcp')
    `);

    // NOT VALID: aplica solo a filas nuevas, no rescana las existentes
    // (más seguro en producción — evita lock prolongado)
    await queryRunner.query(`
      ALTER TABLE contratos
        ADD CONSTRAINT chk_contratos_tipo_auth
          CHECK (tipo_auth IN ('pppoe', 'amarre_ip_mac', 'amarre_ip_mac_dhcp'))
          NOT VALID
    `);

    // Validar en segundo paso (lee la tabla con lock mínimo)
    await queryRunner.query(`
      ALTER TABLE contratos
        VALIDATE CONSTRAINT chk_contratos_tipo_auth
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        DROP CONSTRAINT IF EXISTS chk_contratos_tipo_auth
    `);
  }
}
