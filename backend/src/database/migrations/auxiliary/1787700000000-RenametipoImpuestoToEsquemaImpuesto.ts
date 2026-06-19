import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenametipoImpuestoToEsquemaImpuesto1787700000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      UPDATE plantillas_abonados
      SET facturacion = (facturacion - 'tipoImpuesto')
                        || jsonb_build_object('esquemaImpuesto', facturacion->>'tipoImpuesto')
      WHERE facturacion ? 'tipoImpuesto'
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      UPDATE plantillas_abonados
      SET facturacion = (facturacion - 'esquemaImpuesto')
                        || jsonb_build_object('tipoImpuesto', facturacion->>'esquemaImpuesto')
      WHERE facturacion ? 'esquemaImpuesto'
    `);
  }
}
