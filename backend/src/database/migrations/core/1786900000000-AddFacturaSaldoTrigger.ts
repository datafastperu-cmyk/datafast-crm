import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFacturaSaldoTrigger1786900000000 implements MigrationInterface {
  name = 'AddFacturaSaldoTrigger1786900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_sync_factura_saldo()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.saldo := COALESCE(NEW.total, 0) - COALESCE(NEW.monto_pagado, 0);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_factura_saldo ON facturas`);
    await queryRunner.query(`
      CREATE TRIGGER trg_factura_saldo
        BEFORE INSERT OR UPDATE OF total, monto_pagado
        ON facturas
        FOR EACH ROW
        EXECUTE FUNCTION fn_sync_factura_saldo();
    `);

    // saldo es GENERATED ALWAYS AS (total - monto_pagado) STORED en el esquema existente;
    // el trigger es redundante pero inofensivo. No actualizamos saldo manualmente.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_factura_saldo ON facturas`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_sync_factura_saldo()`);
  }
}
