import { MigrationInterface, QueryRunner } from 'typeorm';
import { promesasPagoContratoRealPasoA } from '../dinero/paso-a-guardas';

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
 *
 * La guarda (huérfanos + VIO de dinero) vive en `../dinero/paso-a-guardas.ts`, no aquí —
 * mismo razonamiento que en `pagos`: el test de CI con datos sembrados
 * (`scripts/verificar-paso-a-dinero.ts`) llama a la MISMA función.
 */
export class PromesasPagoContratoRealPasoA1791800000065 implements MigrationInterface {
  name = 'PromesasPagoContratoRealPasoA1791800000065';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE promesas_pago
        ADD COLUMN contrato_id_real UUID REFERENCES contratos(id) ON DELETE SET NULL
    `);

    await promesasPagoContratoRealPasoA(q);

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

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_promesas_contrato_real`);
    await q.query(`ALTER TABLE promesas_pago DROP COLUMN IF EXISTS contrato_id_real`);
  }
}
