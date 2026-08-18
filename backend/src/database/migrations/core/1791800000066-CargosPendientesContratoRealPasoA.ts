import { MigrationInterface, QueryRunner } from 'typeorm';
import { cargosPendientesContratoRealPasoA } from '../dinero/paso-a-guardas';

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
 *
 * La guarda (huérfanos + VIO de dinero) vive en `../dinero/paso-a-guardas.ts`, no aquí —
 * mismo razonamiento que en `pagos`/`promesas_pago`: el test de CI con datos sembrados
 * (`scripts/verificar-paso-a-dinero.ts`) llama a la MISMA función.
 */
export class CargosPendientesContratoRealPasoA1791800000066 implements MigrationInterface {
  name = 'CargosPendientesContratoRealPasoA1791800000066';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE cargos_pendientes
        ADD COLUMN servicio_id    UUID REFERENCES servicios(id) ON DELETE SET NULL,
        ADD COLUMN contrato_id_real UUID REFERENCES contratos(id) ON DELETE SET NULL
    `);

    await cargosPendientesContratoRealPasoA(q);

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
