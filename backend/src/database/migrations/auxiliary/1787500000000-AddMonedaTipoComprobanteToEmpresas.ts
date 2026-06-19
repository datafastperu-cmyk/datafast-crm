import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMonedaTipoComprobanteToEmpresas1787500000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'PEN',
        ADD COLUMN IF NOT EXISTS tipo_comprobante_default VARCHAR(20) NOT NULL DEFAULT 'boleta';
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS moneda,
        DROP COLUMN IF EXISTS tipo_comprobante_default;
    `);
  }
}
