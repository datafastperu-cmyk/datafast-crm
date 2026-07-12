import { MigrationInterface, QueryRunner } from 'typeorm';

// Inc.3 (reconciliación): columnas de estado aplicado en la ONU.
//   revision              = config de negocio DESEADA (sube en cada cambio)
//   last_applied_revision = última revisión que quedó APLICADA con éxito en la ONU
//   drift  ⇔  last_applied_revision IS NULL OR last_applied_revision < revision
export class AddReconcileColumnsContratoOnuConfig1791700000005 implements MigrationInterface {
  name = 'AddReconcileColumnsContratoOnuConfig1791700000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        ADD COLUMN IF NOT EXISTS last_applied_revision INT,
        ADD COLUMN IF NOT EXISTS last_provisioned_at   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_provision_result TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        DROP COLUMN IF EXISTS last_applied_revision,
        DROP COLUMN IF EXISTS last_provisioned_at,
        DROP COLUMN IF EXISTS last_provision_result;
    `);
  }
}
