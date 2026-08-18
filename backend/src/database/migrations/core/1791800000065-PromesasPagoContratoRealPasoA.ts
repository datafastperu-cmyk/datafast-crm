import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2, lote de DINERO — Paso A (aditiva, reversible). Mismo patrón y misma razón que
 * `1791800000064-PagosContratoRealPasoA.ts`: `promesas_pago.contrato_id` guarda hoy un
 * `servicios.id` (fase 3a), y una promesa de pago es contra la deuda consolidada, sin
 * dimensión de servicio — su destino final es un `contrato_id` con el ACUERDO real. Es
 * TRADUCCIÓN DE VALORES, no un renombrado: nunca se sobreescribe en su sitio (el mapa
 * servicio→contrato es N:1 y no se puede reconstruir en el `down()`).
 *
 * Este Paso A solo AÑADE `contrato_id_real` (nullable a propósito: `contrato_id` sigue
 * NOT NULL y es la fuente de verdad; si `contrato_id_real` naciera NOT NULL, cualquier
 * INSERT de hoy —que no la conoce— rompería en caliente). El Paso B migra
 * lectores/escritores y solo entonces retira la columna vieja.
 */
export class PromesasPagoContratoRealPasoA1791800000065 implements MigrationInterface {
  name = 'PromesasPagoContratoRealPasoA1791800000065';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE promesas_pago
        ADD COLUMN contrato_id_real UUID REFERENCES contratos(id) ON DELETE SET NULL
    `);

    // `contrato_id` es NOT NULL aquí: TODA promesa debe traducir. Igual que en pagos, no
    // se inventa un contrato ni se deja en NULL en silencio si el servicio referenciado
    // quedó sin acuerdo (soft-deleted antes de la fase 3b).
    const huerfanas: Array<{ id: string; contrato_id: string }> = await q.query(`
      SELECT pp.id, pp.contrato_id
        FROM promesas_pago pp
        JOIN servicios s ON s.id = pp.contrato_id
       WHERE s.contrato_id IS NULL
       LIMIT 20
    `);
    if (huerfanas.length > 0) {
      const [{ total }] = await q.query(`
        SELECT COUNT(*)::text AS total
          FROM promesas_pago pp
          JOIN servicios s ON s.id = pp.contrato_id
         WHERE s.contrato_id IS NULL
      `);
      throw new Error(
        `Paso A (promesas_pago): ${total} promesa(s) apuntan a un servicio sin acuerdo `
        + `(soft-deleted antes de la fase 3b) — no se traduce a ciegas. Ejemplos: `
        + huerfanas.slice(0, 5).map((f) => `${f.id}→${f.contrato_id}`).join(', '),
      );
    }

    // VIO aplicado a la migración: se prueba, no se confía. `monto_prometido` y
    // `deuda_al_crear` son las cifras de dinero de esta tabla; este paso no debe moverlas.
    const antes = await this.snapshot(q);

    await q.query(`
      UPDATE promesas_pago pp
         SET contrato_id_real = s.contrato_id
        FROM servicios s
       WHERE s.id = pp.contrato_id
    `);

    const despues = await this.snapshot(q);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      throw new Error(
        'Paso A (promesas_pago): el monto prometido/deuda_al_crear por cliente cambió '
        + 'durante la migración — se revierte. Este paso solo debía escribir '
        + 'contrato_id_real.',
      );
    }

    await q.query(`
      CREATE INDEX idx_promesas_contrato_real ON promesas_pago (contrato_id_real)
        WHERE contrato_id_real IS NOT NULL
    `);

    await q.query(`
      COMMENT ON COLUMN promesas_pago.contrato_id_real IS
        'Paso A del lote de dinero (Ola 2): el ACUERDO real (tabla contratos), traducido '
        'desde contrato_id vía servicios.contrato_id. Aditiva -- nadie la lee todavia. '
        'contrato_id sigue siendo la fuente de verdad hasta el Paso B.'
    `);
  }

  /** SUM por empresa+cliente de las dos cifras de dinero de la tabla, orden estable. */
  private async snapshot(q: QueryRunner): Promise<Array<{
    empresa_id: string; cliente_id: string; prometido: string; al_crear: string;
  }>> {
    return q.query(`
      SELECT empresa_id, cliente_id,
             SUM(monto_prometido)::text AS prometido,
             SUM(deuda_al_crear)::text  AS al_crear
        FROM promesas_pago
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_promesas_contrato_real`);
    await q.query(`ALTER TABLE promesas_pago DROP COLUMN IF EXISTS contrato_id_real`);
  }
}
