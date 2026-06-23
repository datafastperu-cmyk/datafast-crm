import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La entidad Factura declara tipo_comprobante como varchar(30) libre
 * (snapshot del código del ComprobantesConfig al momento de emitir).
 * Sin embargo la migración original lo creó como PostgreSQL enum.
 * Esto causa QueryFailedError cuando el código del comprobante ('ci', 'fac', etc.)
 * no es uno de los valores del enum original.
 * Esta migración corrige el desfase convirtiendo la columna a VARCHAR.
 */
export class ConvertTipoComprobanteToVarchar1788800000000 implements MigrationInterface {
  name = 'ConvertTipoComprobanteToVarchar1788800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar el DEFAULT que referencia el tipo enum
    await queryRunner.query(`
      ALTER TABLE facturas
        ALTER COLUMN tipo_comprobante DROP DEFAULT
    `);

    // 2. Convertir la columna de enum a VARCHAR(30)
    await queryRunner.query(`
      ALTER TABLE facturas
        ALTER COLUMN tipo_comprobante TYPE VARCHAR(30)
        USING tipo_comprobante::TEXT
    `);

    // 3. Restaurar el default como string literal simple
    await queryRunner.query(`
      ALTER TABLE facturas
        ALTER COLUMN tipo_comprobante SET DEFAULT 'boleta'
    `);

    // 4. Eliminar el tipo enum ahora que ninguna dependencia queda
    await queryRunner.query(`
      DROP TYPE IF EXISTS tipo_comprobante
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Recrear el enum con los valores originales
    await queryRunner.query(`
      CREATE TYPE tipo_comprobante AS ENUM (
        'boleta',
        'factura',
        'nota_credito',
        'nota_debito',
        'recibo_interno'
      )
    `);

    // Revertir la columna al enum (fallará si hay valores fuera del enum)
    await queryRunner.query(`
      ALTER TABLE facturas
        ALTER COLUMN tipo_comprobante TYPE tipo_comprobante
        USING tipo_comprobante::tipo_comprobante
    `);
  }
}
