import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2, lote de DINERO — Paso B de `pagos` (autorizado 2026-08-18, forma corregida por
 * el propietario sobre el plan original). Mismo razonamiento y misma forma que
 * `1791800000069-PromesasPagoPasoB.ts`: la clasificación no cambia (la deuda es del
 * acuerdo, A-4/E02-01/E02-02), pero completar el Paso B con una traducción de valores
 * habría exigido decidir comportamiento nuevo — a quién reactiva un pago bajo un acuerdo
 * con varios servicios — y eso es Ola 4/5, con clientes cortados de por medio.
 *
 * `pagos.contrato_id` es, además, el caso con más consumidores del lote (mapeado por
 * agente de investigación, 2026-08-18): la reactivación automática tras verificar un pago
 * (`verificarYReactivarContrato`) depende de él en tres sitios independientes de la MISMA
 * llamada (`ContratosService.findOne`, `DeudaPorContratoService.calcular()`,
 * `vencidaQueBloquea()`), los tres keyed por `servicios.id`. Confirmado en el mismo
 * mapeo: dos bugs preexistentes, NO causados por este Paso B y corregidos aparte
 * (commit `b793cfcf`, 2026-08-18) — `registrar()` escribía `contrato_id = NULL` en todo
 * pago de caja, y el fallback de `aplicarPagoAFacturaYContrato()` leía
 * `facturas.contrato_id` (el ACUERDO, no el servicio) — así que la reactivación llevaba
 * ocho días rota por una razón distinta a la de esta migración.
 *
 * Forma con CERO cambio de comportamiento, igual que `facturas` y que
 * `promesas_pago`:
 *   - `contrato_id` (hoy un `servicios.id` bajo un nombre que mentía) → RENOMBRAR a
 *     `servicio_id`.
 *   - `contrato_id_real` (Paso A, ya poblada, FK al acuerdo real, nadie la lee) →
 *     RENOMBRAR a `contrato_id`.
 */
export class PagosPasoB1791800000070 implements MigrationInterface {
  name = 'PagosPasoB1791800000070';

  public async up(q: QueryRunner): Promise<void> {
    // VIO aplicado a la migración: el renombrado no debería mover dinero — se prueba, no
    // se confía.
    const antes: Array<{ empresa_id: string; cliente_id: string; total: string }> = await q.query(`
      SELECT empresa_id, cliente_id, SUM(monto)::text AS total
        FROM pagos
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);

    await q.query(`ALTER TABLE pagos RENAME COLUMN contrato_id TO servicio_id`);
    await q.query(`ALTER TABLE pagos RENAME COLUMN contrato_id_real TO contrato_id`);
    await q.query(`ALTER INDEX idx_pagos_contrato_real RENAME TO idx_pagos_contrato`);

    const despues: Array<{ empresa_id: string; cliente_id: string; total: string }> = await q.query(`
      SELECT empresa_id, cliente_id, SUM(monto)::text AS total
        FROM pagos
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      throw new Error(
        'Paso B (pagos): el monto cobrado por cliente cambió durante la migración — se '
        + 'revierte.',
      );
    }

    await q.query(`
      COMMENT ON COLUMN pagos.servicio_id IS
        'El Servicio Contratado (tabla servicios) al que aplica el pago. Se llamaba '
        'contrato_id, heredado del nombre de la tabla antes de la fase 3a (2026-08-09).'
    `);
    await q.query(`
      COMMENT ON COLUMN pagos.contrato_id IS
        'El ACUERDO (tabla contratos) del que cuelga el pago. Renombrado desde '
        'contrato_id_real en el Paso B (Ola 2, 2026-08-18). Poblado, sin lectores todavía '
        '-- ver PENDIENTES.md sobre el hallazgo de diseño para la Ola 4/5.'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Irreversible por diseño, igual que el resto del lote de dinero.
    throw new Error(
      'Paso B (pagos) no es reversible. Restaurar desde backup si hace falta deshacer esto.',
    );
  }
}
