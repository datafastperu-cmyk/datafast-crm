import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2, lote de DINERO — Paso B de `promesas_pago` (autorizado 2026-08-18, forma
 * corregida por el propietario sobre el plan original).
 *
 * La clasificación NO cambia: la deuda sigue siendo del acuerdo (A-4, E02-01/E02-02). Lo
 * que cambia es la forma de completar el Paso B, después de que un mapeo de consumidores
 * mostrara que TODO el código vivo de `promesas_pago` lee/escribe por SERVICIO — creación,
 * cancelación, cumplimiento (`onPagoVerificado`), el guard de deuda del corte automático,
 * el listado — sin una sola excepción. Convertir `contrato_id` en el acuerdo real (como
 * proponía la primera versión del Paso B) habría requerido decidir comportamiento nuevo
 * (a quién reactiva un pago bajo un acuerdo con varios servicios, contra qué compite una
 * promesa activa) — eso es Ola 4/5, con clientes cortados de por medio, y no cabe en un
 * renombrado.
 *
 * Forma con CERO cambio de comportamiento, igual que ya tiene `facturas`:
 *   - `contrato_id` (hoy un `servicios.id` bajo un nombre que mentía) → RENOMBRAR a
 *     `servicio_id`. Mismo valor, mismos lectores — todos siguen funcionando exactamente
 *     igual, y muere la ambigüedad de tener una columna `contrato_id` con un id de servicio.
 *   - `contrato_id_real` (Paso A, ya poblada, FK al acuerdo real, nadie la lee) →
 *     RENOMBRAR a `contrato_id`.
 *
 * El índice único parcial `idx_promesas_una_activa_por_contrato` se queda con su REGLA
 * intacta (una promesa activa por SERVICIO) — solo se renombra el índice para que su
 * nombre siga siendo honesto sobre la columna que ahora vigila. Cambiar la regla a
 * "una por ACUERDO" es una decisión de negocio de la Ola 4, registrada, no tomada aquí.
 */
export class PromesasPagoPasoB1791800000069 implements MigrationInterface {
  name = 'PromesasPagoPasoB1791800000069';

  public async up(q: QueryRunner): Promise<void> {
    // VIO aplicado a la migración: el renombrado no debería mover dinero — se prueba, no
    // se confía.
    const antes: Array<{ empresa_id: string; cliente_id: string; prometido: string; al_crear: string }> = await q.query(`
      SELECT empresa_id, cliente_id,
             SUM(monto_prometido)::text AS prometido,
             SUM(deuda_al_crear)::text  AS al_crear
        FROM promesas_pago
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);

    await q.query(`ALTER TABLE promesas_pago RENAME COLUMN contrato_id TO servicio_id`);
    await q.query(`ALTER TABLE promesas_pago RENAME COLUMN contrato_id_real TO contrato_id`);
    await q.query(`
      ALTER INDEX idx_promesas_una_activa_por_contrato RENAME TO idx_promesas_una_activa_por_servicio
    `);
    await q.query(`ALTER INDEX idx_promesas_contrato_real RENAME TO idx_promesas_contrato`);

    const despues: Array<{ empresa_id: string; cliente_id: string; prometido: string; al_crear: string }> = await q.query(`
      SELECT empresa_id, cliente_id,
             SUM(monto_prometido)::text AS prometido,
             SUM(deuda_al_crear)::text  AS al_crear
        FROM promesas_pago
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      throw new Error(
        'Paso B (promesas_pago): el monto prometido/deuda_al_crear por cliente cambió '
        + 'durante la migración — se revierte.',
      );
    }

    await q.query(`
      COMMENT ON COLUMN promesas_pago.servicio_id IS
        'El Servicio Contratado (tabla servicios) al que aplica la promesa. Se llamaba '
        'contrato_id, heredado del nombre de la tabla antes de la fase 3a (2026-08-09).'
    `);
    await q.query(`
      COMMENT ON COLUMN promesas_pago.contrato_id IS
        'El ACUERDO (tabla contratos) del que cuelga la promesa. Renombrado desde '
        'contrato_id_real en el Paso B (Ola 2, 2026-08-18). Poblado, sin lectores todavía '
        '-- ver PENDIENTES.md sobre el hallazgo de diseño para la Ola 4/5.'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Irreversible por diseño, igual que el resto del lote de dinero: no hay forma de
    // reconstruir qué valor tenía originalmente cada columna sin el mapa N:1 inverso.
    throw new Error(
      'Paso B (promesas_pago) no es reversible. Restaurar desde backup si hace falta '
      + 'deshacer esto.',
    );
  }
}
