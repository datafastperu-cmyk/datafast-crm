import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropMontoMoraReconexionFromConfigFacturacion1786800000000 implements MigrationInterface {
  name = 'DropMontoMoraReconexionFromConfigFacturacion1786800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE configuracion_facturacion DROP COLUMN IF EXISTS monto_reconexion`);
    await queryRunner.query(`ALTER TABLE configuracion_facturacion DROP COLUMN IF EXISTS porcentaje_mora`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE configuracion_facturacion ADD COLUMN IF NOT EXISTS monto_reconexion DECIMAL(10,2) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE configuracion_facturacion ADD COLUMN IF NOT EXISTS porcentaje_mora DECIMAL(5,2) NOT NULL DEFAULT 0`);
  }
}
