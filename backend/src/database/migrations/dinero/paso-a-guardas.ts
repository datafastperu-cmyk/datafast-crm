import { QueryRunner } from 'typeorm';

/**
 * Guardas del Paso A del lote de DINERO (Ola 2), extraídas de las migraciones
 * `1791800000064/065/066` para que el test de CI con datos sembrados
 * (`scripts/verificar-paso-a-dinero.ts`) ejerza EXACTAMENTE la misma lógica que corre en
 * producción — no una copia que puede divergir de lo que la migración hace de verdad.
 *
 * Cada función asume que la columna destino YA EXISTE (el `ALTER TABLE ADD COLUMN` es
 * DDL de una sola vez y vive en la migración, no aquí) y hace tres cosas, en orden:
 *   1. Falla ruidosa si algún `contrato_id` referenciado apunta a un servicio sin acuerdo
 *      (soft-deleted antes de la fase 3b) — nunca se inventa un contrato ni se calla.
 *   2. Snapshot de dinero por cliente ANTES de tocar nada.
 *   3. Backfill, snapshot DESPUÉS, y comparación — VIO aplicado a la migración.
 */

/** Un `contrato_id` referenciado apunta a un servicio sin acuerdo. La migración NO continúa. */
export class PasoAHuerfanoError extends Error {
  constructor(tabla: string, total: number, muestra: Array<{ id: string; contrato_id: string }>) {
    super(
      `Paso A (${tabla}): ${total} fila(s) apuntan a un servicio sin acuerdo (soft-deleted ` +
      `antes de la fase 3b) — no se traduce a ciegas. Ejemplos: ` +
      muestra.slice(0, 5).map((f) => `${f.id}→${f.contrato_id}`).join(', '),
    );
    this.name = 'PasoAHuerfanoError';
  }
}

/** El dinero por cliente cambió durante el Paso A. Nunca debería, porque no toca `monto`. */
export class PasoADineroSeMovioError extends Error {
  constructor(tabla: string, detalle: string) {
    super(`Paso A (${tabla}): ${detalle} cambió durante la migración — se revierte.`);
    this.name = 'PasoADineroSeMovioError';
  }
}

async function huerfanos(
  q: QueryRunner,
  tabla: string,
  filtroFilas: string,
): Promise<void> {
  const muestra: Array<{ id: string; contrato_id: string }> = await q.query(`
    SELECT t.id, t.contrato_id
      FROM ${tabla} t
      JOIN servicios s ON s.id = t.contrato_id
     WHERE ${filtroFilas}
       AND s.contrato_id IS NULL
     LIMIT 20
  `);
  if (muestra.length === 0) return;

  const [{ total }] = await q.query(`
    SELECT COUNT(*)::text AS total
      FROM ${tabla} t
      JOIN servicios s ON s.id = t.contrato_id
     WHERE ${filtroFilas}
       AND s.contrato_id IS NULL
  `);
  throw new PasoAHuerfanoError(tabla, Number(total), muestra);
}

/** Paso A de `pagos`: añade `contrato_id_real`, sin dimensión de servicio (criterio v2). */
export async function pagosContratoRealPasoA(q: QueryRunner): Promise<void> {
  await huerfanos(q, 'pagos', 't.contrato_id IS NOT NULL');

  const antes = await q.query(`
    SELECT empresa_id, cliente_id, SUM(monto)::text AS total
      FROM pagos
     GROUP BY empresa_id, cliente_id
     ORDER BY empresa_id, cliente_id
  `);

  await q.query(`
    UPDATE pagos p
       SET contrato_id_real = s.contrato_id
      FROM servicios s
     WHERE s.id = p.contrato_id
       AND p.contrato_id IS NOT NULL
  `);

  const despues = await q.query(`
    SELECT empresa_id, cliente_id, SUM(monto)::text AS total
      FROM pagos
     GROUP BY empresa_id, cliente_id
     ORDER BY empresa_id, cliente_id
  `);
  if (JSON.stringify(antes) !== JSON.stringify(despues)) {
    throw new PasoADineroSeMovioError('pagos', 'el monto cobrado por cliente');
  }
}

/** Paso A de `promesas_pago`: añade `contrato_id_real`. `contrato_id` es NOT NULL aquí. */
export async function promesasPagoContratoRealPasoA(q: QueryRunner): Promise<void> {
  await huerfanos(q, 'promesas_pago', 'TRUE');

  const antes = await q.query(`
    SELECT empresa_id, cliente_id,
           SUM(monto_prometido)::text AS prometido,
           SUM(deuda_al_crear)::text  AS al_crear
      FROM promesas_pago
     GROUP BY empresa_id, cliente_id
     ORDER BY empresa_id, cliente_id
  `);

  await q.query(`
    UPDATE promesas_pago pp
       SET contrato_id_real = s.contrato_id
      FROM servicios s
     WHERE s.id = pp.contrato_id
  `);

  const despues = await q.query(`
    SELECT empresa_id, cliente_id,
           SUM(monto_prometido)::text AS prometido,
           SUM(deuda_al_crear)::text  AS al_crear
      FROM promesas_pago
     GROUP BY empresa_id, cliente_id
     ORDER BY empresa_id, cliente_id
  `);
  if (JSON.stringify(antes) !== JSON.stringify(despues)) {
    throw new PasoADineroSeMovioError('promesas_pago', 'el monto prometido/deuda_al_crear por cliente');
  }
}

/**
 * Paso A de `cargos_pendientes`: añade `servicio_id` (copia directa, solo
 * `tipo IN ('servicio','reconexion')` — la mora no) + `contrato_id_real` (traducido,
 * todo tipo incluida la mora).
 */
export async function cargosPendientesContratoRealPasoA(q: QueryRunner): Promise<void> {
  await huerfanos(q, 'cargos_pendientes', 't.contrato_id IS NOT NULL');

  const antes = await q.query(`
    SELECT empresa_id, cliente_id, SUM(monto)::text AS total
      FROM cargos_pendientes
     GROUP BY empresa_id, cliente_id
     ORDER BY empresa_id, cliente_id
  `);

  await q.query(`
    UPDATE cargos_pendientes
       SET servicio_id = contrato_id
     WHERE contrato_id IS NOT NULL
       AND tipo IN ('servicio', 'reconexion')
  `);

  await q.query(`
    UPDATE cargos_pendientes c
       SET contrato_id_real = s.contrato_id
      FROM servicios s
     WHERE s.id = c.contrato_id
       AND c.contrato_id IS NOT NULL
  `);

  const despues = await q.query(`
    SELECT empresa_id, cliente_id, SUM(monto)::text AS total
      FROM cargos_pendientes
     GROUP BY empresa_id, cliente_id
     ORDER BY empresa_id, cliente_id
  `);
  if (JSON.stringify(antes) !== JSON.stringify(despues)) {
    throw new PasoADineroSeMovioError('cargos_pendientes', 'el monto pendiente por cliente');
  }
}
