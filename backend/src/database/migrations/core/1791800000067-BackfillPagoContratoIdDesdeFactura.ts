import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix de incidente — NO es Ola 2 (2026-08-18).
 *
 * `pagos.service.ts` escribía `servicioId` en el objeto que pasa a
 * `manager.create(Pago, {...})`. `Pago` nunca declaró esa propiedad —solo
 * `contratoId`— así que TypeORM la descartaba en silencio: todo pago de caja
 * registrado desde el commit `3c94c55b` (fase 4.1, 2026-08-10 11:05:48) quedó con
 * `contrato_id = NULL`. El mismo defecto, con otra forma, estaba en el webhook de
 * MercadoPago y en el fallback de `aplicarPagoAFacturaYContrato`: los dos leían
 * `facturas.contrato_id`, que desde la fase 4.2a es el ACUERDO real, no el
 * servicio — un valor con el significado equivocado alimentando
 * `verificarYReactivarContrato()`, que lo compara contra `servicios` y no
 * encuentra nada.
 *
 * Medido contra producción antes de escribir esto (no contra memoria, 2026-08-18):
 * 2 filas totales en `pagos`, las 2 con `contrato_id IS NULL`, las 2 ANTERIORES al
 * commit del defecto (2026-08-04 y 2026-08-05) — ninguna causada por él. Cero pagos
 * registrados desde el commit. El backfill de abajo es, por tanto, un no-op sobre
 * los datos de hoy: se despliega igual porque es la corrección correcta y porque el
 * próximo pago real síi la habría necesitado.
 *
 * Backfill: `pagos.contrato_id` para toda fila NULL con `factura_id` resuelto,
 * desde `facturas.servicio_id` — la misma fuente que el código ya corregido usa en
 * tiempo de ejecución. Una factura consolidada (`servicio_id IS NULL`) deja el pago
 * en NULL: es el comportamiento correcto, no un caso sin cubrir.
 */
export class BackfillPagoContratoIdDesdeFactura1791800000067 implements MigrationInterface {
  name = 'BackfillPagoContratoIdDesdeFactura1791800000067';

  public async up(q: QueryRunner): Promise<void> {
    const antes: Array<{ total: string }> = await q.query(`
      SELECT COUNT(*)::text AS total FROM pagos WHERE contrato_id IS NULL
    `);

    await q.query(`
      UPDATE pagos p
         SET contrato_id = f.servicio_id
        FROM facturas f
       WHERE p.factura_id = f.id
         AND p.contrato_id IS NULL
         AND f.servicio_id IS NOT NULL
    `);

    const despues: Array<{ total: string }> = await q.query(`
      SELECT COUNT(*)::text AS total FROM pagos WHERE contrato_id IS NULL
    `);

    // No es VIO de dinero (no hay monto en juego aquí, solo un FK) — es una constancia
    // de auditoría: cuántas filas quedaban afectadas al momento del despliegue.
    console.log(
      `[BackfillPagoContratoId] pagos con contrato_id NULL: ${antes[0]?.total} antes -> `
      + `${despues[0]?.total} después.`,
    );
  }

  public async down(): Promise<void> {
    // Irreversible a propósito: no hay forma de distinguir un contrato_id que YA estaba
    // poblado antes de este backfill de uno que este backfill acaba de escribir, y
    // deshacerlo pondría en NULL pagos que el backfill nunca tocó. Un `down()` que
    // sobreescribe datos ajenos es peor que ningún `down()`.
  }
}
