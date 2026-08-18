import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2, lote de DINERO — Paso A (aditiva, reversible). `pagos.contrato_id` guarda hoy un
 * `servicios.id` (fase 3a): el criterio del propietario dice que un pago es contra la
 * deuda, sin dimensión de servicio, así que su destino final es un `contrato_id` con el
 * ACUERDO real. Pero eso es TRADUCCIÓN DE VALORES, no un renombrado de columna, y
 * **nunca se sobreescribe el valor en su sitio**: el mapa servicio→contrato es N:1, y una
 * vez pisado no hay forma de reconstruirlo en el `down()`.
 *
 * Por eso este Paso A solo AÑADE `contrato_id_real`, poblada desde el mapa
 * (`servicios.contrato_id`, FK real desde la fase 3b). La columna vieja `contrato_id`
 * queda INTACTA y nadie la sustituye todavía — ningún servicio, ninguna consulta lee
 * `contrato_id_real` en este commit. El Paso B (aparte, con revisión del propietario antes
 * de arrancar) migra lectores/escritores y solo entonces retira la columna vieja.
 */
export class PagosContratoRealPasoA1791800000064 implements MigrationInterface {
  name = 'PagosContratoRealPasoA1791800000064';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pagos
        ADD COLUMN contrato_id_real UUID REFERENCES contratos(id) ON DELETE SET NULL
    `);

    // Ningún pago vivo sin acuerdo: el mapa es servicios.contrato_id, NOT NULL en los
    // servicios vivos desde la fase 3b y NULL solo en servicios borrados ANTES de esa
    // fase. Si aparece uno, no se inventa un contrato ni se deja en NULL en silencio: se
    // para y se reporta.
    const huerfanos: Array<{ id: string; contrato_id: string }> = await q.query(`
      SELECT p.id, p.contrato_id
        FROM pagos p
        JOIN servicios s ON s.id = p.contrato_id
       WHERE p.contrato_id IS NOT NULL
         AND s.contrato_id IS NULL
       LIMIT 20
    `);
    if (huerfanos.length > 0) {
      const [{ total }] = await q.query(`
        SELECT COUNT(*)::text AS total
          FROM pagos p
          JOIN servicios s ON s.id = p.contrato_id
         WHERE p.contrato_id IS NOT NULL AND s.contrato_id IS NULL
      `);
      throw new Error(
        `Paso A (pagos): ${total} pago(s) apuntan a un servicio sin acuerdo (soft-deleted `
        + `antes de la fase 3b) — no se traduce a ciegas. Ejemplos: `
        + huerfanos.slice(0, 5).map((f) => `${f.id}→${f.contrato_id}`).join(', '),
      );
    }

    // VIO aplicado a la migración: que el ALTER no dé error no dice si los datos quedaron
    // bien. Se prueba, no se confía — snapshot de lo único que este paso NO debería tocar.
    const antes = await this.snapshot(q);

    await q.query(`
      UPDATE pagos p
         SET contrato_id_real = s.contrato_id
        FROM servicios s
       WHERE s.id = p.contrato_id
         AND p.contrato_id IS NOT NULL
    `);

    const despues = await this.snapshot(q);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      throw new Error(
        'Paso A (pagos): el monto cobrado por cliente cambió durante la migración — se '
        + 'revierte. Este paso solo debía escribir contrato_id_real.',
      );
    }

    await q.query(`
      CREATE INDEX idx_pagos_contrato_real ON pagos (contrato_id_real)
        WHERE contrato_id_real IS NOT NULL
    `);

    await q.query(`
      COMMENT ON COLUMN pagos.contrato_id_real IS
        'Paso A del lote de dinero (Ola 2): el ACUERDO real (tabla contratos), traducido '
        'desde contrato_id vía servicios.contrato_id. Aditiva -- nadie la lee todavia. '
        'contrato_id sigue siendo la fuente de verdad hasta el Paso B.'
    `);
  }

  /** SUM(monto) por empresa+cliente, orden estable — lo único que este paso no debe mover. */
  private async snapshot(q: QueryRunner): Promise<Array<{ empresa_id: string; cliente_id: string; total: string }>> {
    return q.query(`
      SELECT empresa_id, cliente_id, SUM(monto)::text AS total
        FROM pagos
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_pagos_contrato_real`);
    await q.query(`ALTER TABLE pagos DROP COLUMN IF EXISTS contrato_id_real`);
  }
}
