import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renombra el valor de enum 'pendiente_instalacion' → 'pendiente_activacion'
 * en los tipos estado_cliente y estado_contrato.
 *
 * ALTER TYPE ... RENAME VALUE no requiere conversión de datos ni toca filas;
 * solo actualiza el catálogo pg_enum. Operación O(1) sin lock de tabla.
 */
export class RenombrarPendienteActivacion1785400001000 implements MigrationInterface {
  name = 'RenombrarPendienteActivacion1785400001000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TYPE estado_cliente  RENAME VALUE 'pendiente_instalacion' TO 'pendiente_activacion'`);
    await qr.query(`ALTER TYPE estado_contrato RENAME VALUE 'pendiente_instalacion' TO 'pendiente_activacion'`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TYPE estado_cliente  RENAME VALUE 'pendiente_activacion' TO 'pendiente_instalacion'`);
    await qr.query(`ALTER TYPE estado_contrato RENAME VALUE 'pendiente_activacion' TO 'pendiente_instalacion'`);
  }
}
