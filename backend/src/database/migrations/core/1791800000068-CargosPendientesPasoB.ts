import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2, lote de DINERO — Paso B de `cargos_pendientes` (autorizado 2026-08-18).
 *
 * Cierra lo que el Paso A dejó a medio camino. La clasificación no cambia -- la deuda es
 * del acuerdo (A-4, E02-01/E02-02) -- lo único que faltaba era que el código escribiera y
 * leyera las dos columnas por su nombre real:
 *
 *   1. Escritor único (`facturacion.service.ts`, `registrarCargoPendiente()`) movido a
 *      escribir `servicioId` (siempre que `tipo IN ('servicio','reconexion')`, NULL en
 *      mora) + `contratoId` (el acuerdo, resuelto vía `FacturaRepository.contratoDe()` --
 *      el mismo resolutor que usa la emisión de facturas, no uno nuevo).
 *   2. Aquí: DROP de la columna vieja (que guardaba un `servicios.id` bajo el nombre
 *      `contrato_id`) y RENAME de `contrato_id_real` (Paso A) a `contrato_id`.
 *
 * `cargos_pendientes` no tenía lectores de ninguna de las dos columnas (mapeado por
 * agente de investigación, 2026-08-18) -- es el motivo por el que este Paso B es "adelante,
 * sin cambios" mientras `pagos`/`promesas_pago` necesitan uno más simple (renombrado puro,
 * ver migraciones 1791800000069/070): aquí la migración de datos YA estaba resuelta por
 * el Paso A, solo faltaba mover el escritor.
 */
export class CargosPendientesPasoB1791800000068 implements MigrationInterface {
  name = 'CargosPendientesPasoB1791800000068';

  public async up(q: QueryRunner): Promise<void> {
    // VIO aplicado a la migración: el DROP+RENAME no debería mover monto — se prueba, no
    // se confía.
    const antes: Array<{ empresa_id: string; cliente_id: string; total: string }> = await q.query(`
      SELECT empresa_id, cliente_id, SUM(monto)::text AS total
        FROM cargos_pendientes
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);

    await q.query(`ALTER TABLE cargos_pendientes DROP COLUMN contrato_id`);
    await q.query(`ALTER TABLE cargos_pendientes RENAME COLUMN contrato_id_real TO contrato_id`);
    await q.query(`
      ALTER INDEX idx_cargos_pendientes_contrato_real RENAME TO idx_cargos_pendientes_contrato
    `);

    const despues: Array<{ empresa_id: string; cliente_id: string; total: string }> = await q.query(`
      SELECT empresa_id, cliente_id, SUM(monto)::text AS total
        FROM cargos_pendientes
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      throw new Error(
        'Paso B (cargos_pendientes): el monto pendiente por cliente cambió durante la '
        + 'migración — se revierte. Este paso solo debía tocar contrato_id.',
      );
    }

    await q.query(`
      COMMENT ON COLUMN cargos_pendientes.contrato_id IS
        'El ACUERDO (tabla contratos) del que cuelga el cargo. Renombrado desde '
        'contrato_id_real en el Paso B (Ola 2, 2026-08-18) -- antes de esta migración '
        '''contrato_id'' guardaba un servicios.id bajo un nombre que mentía. Ver '
        'servicio_id para esa dimensión.'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Irreversible por diseño, igual que el resto del lote de dinero: no hay forma de
    // reconstruir el servicios.id original a partir del contratos.id (el mapa es N:1).
    // Si hace falta revertir, se restaura desde backup — no desde este `down()`.
    throw new Error(
      'Paso B (cargos_pendientes) no es reversible: el mapa servicio->contrato es N:1 y '
      + 'el valor original de contrato_id (un servicios.id) no se puede reconstruir. '
      + 'Restaurar desde backup si hace falta deshacer esto.',
    );
  }
}
