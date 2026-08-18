import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2, lote de DINERO — Paso A (aditiva, reversible). `cargos_pendientes.contrato_id`
 * guarda hoy un `servicios.id` (fase 3a). A diferencia de `pagos`/`promesas_pago`, esta
 * tabla necesita LAS DOS dimensiones (corrección del propietario sobre la clasificación
 * v1): `tipo` es `mora` | `reconexion` | `servicio`, y solo la mora es puramente del
 * acuerdo — una reconexión (y un cargo de servicio) sí la motivó UN servicio concreto.
 * Perder esa dimensión al ganar la de contrato sería el mismo error que ya se evitó en
 * `facturas` (fase 4.1/4.2a): las dos conviven, no se pisan.
 *
 * Añade DOS columnas, ninguna sobrescribe `contrato_id` en su sitio:
 *   - `servicio_id`    — copia directa de `contrato_id` (ya es un valor de `servicios`,
 *     no hace falta traducir), pero SOLO para `tipo IN ('servicio', 'reconexion')`. Un
 *     cargo de `mora` no se queda con un `servicio_id` heredado de cómo se guardaba antes.
 *   - `contrato_id_real` — el ACUERDO real, traducido vía `servicios.contrato_id`, para
 *     TODO cargo con `contrato_id` no nulo (mora incluida: la deuda de mora sigue siendo
 *     de un acuerdo).
 *
 * `contrato_id` sigue siendo la fuente de verdad hasta el Paso B.
 */
export class CargosPendientesContratoRealPasoA1791800000066 implements MigrationInterface {
  name = 'CargosPendientesContratoRealPasoA1791800000066';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE cargos_pendientes
        ADD COLUMN servicio_id    UUID REFERENCES servicios(id) ON DELETE SET NULL,
        ADD COLUMN contrato_id_real UUID REFERENCES contratos(id) ON DELETE SET NULL
    `);

    // Mismo criterio que en pagos/promesas_pago: si un cargo con contrato_id apunta a un
    // servicio sin acuerdo (soft-deleted antes de la fase 3b), no se inventa ni se calla.
    const huerfanos: Array<{ id: string; contrato_id: string }> = await q.query(`
      SELECT c.id, c.contrato_id
        FROM cargos_pendientes c
        JOIN servicios s ON s.id = c.contrato_id
       WHERE c.contrato_id IS NOT NULL
         AND s.contrato_id IS NULL
       LIMIT 20
    `);
    if (huerfanos.length > 0) {
      const [{ total }] = await q.query(`
        SELECT COUNT(*)::text AS total
          FROM cargos_pendientes c
          JOIN servicios s ON s.id = c.contrato_id
         WHERE c.contrato_id IS NOT NULL AND s.contrato_id IS NULL
      `);
      throw new Error(
        `Paso A (cargos_pendientes): ${total} cargo(s) apuntan a un servicio sin acuerdo `
        + `(soft-deleted antes de la fase 3b) — no se traduce a ciegas. Ejemplos: `
        + huerfanos.slice(0, 5).map((f) => `${f.id}→${f.contrato_id}`).join(', '),
      );
    }

    // VIO aplicado a la migración: se prueba, no se confía. `monto` es la única cifra de
    // dinero de esta tabla; este paso no debe moverla.
    const antes = await this.snapshot(q);

    // servicio_id: copia directa, solo para lo que SÍ es de un servicio concreto.
    await q.query(`
      UPDATE cargos_pendientes
         SET servicio_id = contrato_id
       WHERE contrato_id IS NOT NULL
         AND tipo IN ('servicio', 'reconexion')
    `);

    // contrato_id_real: traducido vía el mapa, para todo cargo con contrato_id -- la mora
    // incluida, porque la deuda de mora sigue siendo de un acuerdo.
    await q.query(`
      UPDATE cargos_pendientes c
         SET contrato_id_real = s.contrato_id
        FROM servicios s
       WHERE s.id = c.contrato_id
         AND c.contrato_id IS NOT NULL
    `);

    const despues = await this.snapshot(q);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      throw new Error(
        'Paso A (cargos_pendientes): el monto pendiente por cliente cambió durante la '
        + 'migración — se revierte. Este paso solo debía escribir servicio_id y '
        + 'contrato_id_real.',
      );
    }

    await q.query(`
      CREATE INDEX idx_cargos_pendientes_servicio ON cargos_pendientes (servicio_id)
        WHERE servicio_id IS NOT NULL
    `);
    await q.query(`
      CREATE INDEX idx_cargos_pendientes_contrato_real ON cargos_pendientes (contrato_id_real)
        WHERE contrato_id_real IS NOT NULL
    `);

    await q.query(`
      COMMENT ON COLUMN cargos_pendientes.servicio_id IS
        'Paso A del lote de dinero (Ola 2): que servicio motivo el cargo -- solo para '
        'tipo IN (servicio, reconexion); NULL en mora, que es del acuerdo. Aditiva, nadie '
        'la lee todavia.'
    `);
    await q.query(`
      COMMENT ON COLUMN cargos_pendientes.contrato_id_real IS
        'Paso A del lote de dinero (Ola 2): el ACUERDO real (tabla contratos), traducido '
        'desde contrato_id vía servicios.contrato_id, para todo tipo incluida la mora. '
        'Aditiva -- nadie la lee todavia. contrato_id sigue siendo la fuente de verdad '
        'hasta el Paso B.'
    `);
  }

  /** SUM(monto) por empresa+cliente, orden estable -- lo único que este paso no debe mover. */
  private async snapshot(q: QueryRunner): Promise<Array<{ empresa_id: string; cliente_id: string; total: string }>> {
    return q.query(`
      SELECT empresa_id, cliente_id, SUM(monto)::text AS total
        FROM cargos_pendientes
       GROUP BY empresa_id, cliente_id
       ORDER BY empresa_id, cliente_id
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_cargos_pendientes_contrato_real`);
    await q.query(`DROP INDEX IF EXISTS idx_cargos_pendientes_servicio`);
    await q.query(`
      ALTER TABLE cargos_pendientes
        DROP COLUMN IF EXISTS contrato_id_real,
        DROP COLUMN IF EXISTS servicio_id
    `);
  }
}
