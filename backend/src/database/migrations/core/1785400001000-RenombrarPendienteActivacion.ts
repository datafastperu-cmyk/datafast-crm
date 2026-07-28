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
    // Idempotente por necesidad: una migración de RENOMBRADO asume un estado histórico
    // que en una instalación desde cero puede no existir nunca. Si el enum ya se creó con
    // el nombre nuevo, `ALTER TYPE ... RENAME VALUE` aborta con "is not an existing enum
    // label" y tumba toda la cadena. Se renombra solo si el valor viejo está presente.
    for (const tipo of ['estado_cliente', 'estado_contrato']) {
      await qr.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = '${tipo}' AND e.enumlabel = 'pendiente_instalacion'
          ) THEN
            EXECUTE 'ALTER TYPE ${tipo} RENAME VALUE ''pendiente_instalacion'' TO ''pendiente_activacion''';
          END IF;
        END $$;
      `);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TYPE estado_cliente  RENAME VALUE 'pendiente_activacion' TO 'pendiente_instalacion'`);
    await qr.query(`ALTER TYPE estado_contrato RENAME VALUE 'pendiente_activacion' TO 'pendiente_instalacion'`);
  }
}
