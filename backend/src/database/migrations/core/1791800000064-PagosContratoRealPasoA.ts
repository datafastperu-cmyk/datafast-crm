import { MigrationInterface, QueryRunner } from 'typeorm';
import { pagosContratoRealPasoA } from '../dinero/paso-a-guardas';

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
 *
 * La guarda (huérfanos + VIO de dinero) vive en `../dinero/paso-a-guardas.ts`, no aquí:
 * `scripts/verificar-paso-a-dinero.ts` la ejercita en CI contra datos sembrados llamando a
 * la MISMA función, no a una copia que podría divergir de lo que esto ejecuta en
 * producción (hallazgo del propietario, 2026-08-17: una guarda que nunca vio un dato es
 * decorativa — PC-04).
 */
export class PagosContratoRealPasoA1791800000064 implements MigrationInterface {
  name = 'PagosContratoRealPasoA1791800000064';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pagos
        ADD COLUMN contrato_id_real UUID REFERENCES contratos(id) ON DELETE SET NULL
    `);

    await pagosContratoRealPasoA(q);

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

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_pagos_contrato_real`);
    await q.query(`ALTER TABLE pagos DROP COLUMN IF EXISTS contrato_id_real`);
  }
}
