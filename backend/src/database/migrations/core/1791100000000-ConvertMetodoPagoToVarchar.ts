import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertMetodoPagoToVarchar1791100000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Eliminar índice único que referencia metodo_pago (enum)
    await runner.query(`DROP INDEX IF EXISTS "IDX_pagos_empresa_metodo_operacion"`);

    // Convertir columna de ENUM a VARCHAR
    await runner.query(`
      ALTER TABLE pagos
        ALTER COLUMN metodo_pago TYPE VARCHAR(100)
        USING metodo_pago::text
    `);

    // Recrear índice único con tipo VARCHAR
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pagos_empresa_metodo_operacion"
        ON pagos (empresa_id, metodo_pago, numero_operacion)
        WHERE numero_operacion IS NOT NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS "IDX_pagos_empresa_metodo_operacion"`);
    await runner.query(`
      ALTER TABLE pagos
        ALTER COLUMN metodo_pago TYPE metodo_pago_enum
        USING metodo_pago::metodo_pago_enum
    `);
  }
}
