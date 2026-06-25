import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropFacturaSaldoTrigger1789100000000 implements MigrationInterface {
  name = 'DropFacturaSaldoTrigger1789100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // El trigger fn_sync_factura_saldo intentaba asignar NEW.saldo, que es una
    // columna GENERATED ALWAYS AS (total - monto_pagado) STORED. PostgreSQL
    // lanza el código 428C9 en cualquier UPDATE que modifique monto_pagado,
    // rompiendo el registro y la verificación de pagos.
    // La columna generada ya mantiene el cálculo automáticamente; el trigger
    // es innecesario y destructivo.
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_factura_saldo ON facturas`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_sync_factura_saldo()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // No restauramos el trigger roto intencionalmente.
  }
}
