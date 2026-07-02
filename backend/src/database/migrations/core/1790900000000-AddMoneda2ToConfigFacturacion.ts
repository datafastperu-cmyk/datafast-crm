import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMoneda2ToConfigFacturacion1790900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE configuracion_facturacion
        ADD COLUMN IF NOT EXISTS moneda2 VARCHAR(3) NOT NULL DEFAULT 'USD'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE configuracion_facturacion DROP COLUMN IF EXISTS moneda2
    `);
  }
}
