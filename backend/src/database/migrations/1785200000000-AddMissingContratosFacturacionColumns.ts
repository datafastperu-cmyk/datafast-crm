import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingContratosFacturacionColumns1785200000000
  implements MigrationInterface
{
  name = 'AddMissingContratosFacturacionColumns1785200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        ADD COLUMN IF NOT EXISTS dias_recordatorio_1  SMALLINT,
        ADD COLUMN IF NOT EXISTS dias_recordatorio_2  SMALLINT,
        ADD COLUMN IF NOT EXISTS dias_recordatorio_3  SMALLINT,
        ADD COLUMN IF NOT EXISTS ciclo_facturacion    VARCHAR(20),
        ADD COLUMN IF NOT EXISTS ciclo_pago           VARCHAR(20)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        DROP COLUMN IF EXISTS dias_recordatorio_1,
        DROP COLUMN IF EXISTS dias_recordatorio_2,
        DROP COLUMN IF EXISTS dias_recordatorio_3,
        DROP COLUMN IF EXISTS ciclo_facturacion,
        DROP COLUMN IF EXISTS ciclo_pago
    `);
  }
}
