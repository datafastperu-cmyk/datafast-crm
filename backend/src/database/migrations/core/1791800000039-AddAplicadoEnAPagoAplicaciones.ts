import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Idempotencia de la aplicación del dinero, derivada del estado (F0, 2026-08-06).
//
// `pago_aplicaciones` declaraba QUÉ comprobantes cubre un pago, pero no si esa
// imputación ya se había volcado sobre la factura. Sin ese dato, reintentar la
// aplicación de un pago es indistinguible de aplicarlo por primera vez, y el
// reconciliador no tenía forma de saber que no había nada que hacer.
//
// Consecuencia medida en producción: `pagos-reconciliacion` llevaba 1123 ejecuciones,
// reintentando cada 10 minutos desde el 04/08 dos pagos YA aplicados. `aplicarPago`
// respondía "La factura ya está completamente pagada", el catch se la tragaba,
// `aplicado_en` seguía NULL y el ciclo volvía a empezar. Mismo patrón que los 1788
// reintentos contra el MA5800: una transición no idempotente en manos de un watcher.
//
// Con esta columna la idempotencia deja de implementarse a mano en cada camino y pasa
// a DERIVARSE del estado: si la fila ya está marcada, la operación es `ya_en_destino`
// y contar eso como éxito no es una excepción, es la regla.
//
// Backfill: se marcan como aplicadas TODAS las filas existentes. La justificación es
// una medición, no una suposición — el diagnóstico F0 verificó contra producción que
// `facturas.monto_pagado == SUM(pago_aplicaciones.monto_aplicado)` para el 100% de los
// comprobantes (cero divergencias). Es decir: cada aplicación que existe hoy ya está
// reflejada en su factura. Si esa consulta hubiera devuelto filas, este backfill sería
// incorrecto y habría que resolver las divergencias primero.
// ─────────────────────────────────────────────────────────────────────────────
export class AddAplicadoEnAPagoAplicaciones1791800000039 implements MigrationInterface {
  name = 'AddAplicadoEnAPagoAplicaciones1791800000039';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE pago_aplicaciones
        ADD COLUMN IF NOT EXISTS aplicado_en TIMESTAMPTZ NULL
    `);

    // Guarda de seguridad: si el invariante NO se cumple, el backfill de abajo estaría
    // marcando como aplicado dinero que nunca llegó a la factura. Mejor fallar el
    // despliegue que registrar una mentira que después nadie puede distinguir.
    const divergentes = await qr.query(`
      SELECT COUNT(*)::int AS n
        FROM (
          SELECT f.id
            FROM facturas f
            JOIN pago_aplicaciones pa ON pa.factura_id = f.id
           WHERE f.deleted_at IS NULL
           GROUP BY f.id, f.monto_pagado
          HAVING ABS(f.monto_pagado::numeric - SUM(pa.monto_aplicado)::numeric) > 0.01
        ) x
    `);
    if (Number(divergentes?.[0]?.n ?? 0) > 0) {
      throw new Error(
        `No se puede marcar el histórico como aplicado: ${divergentes[0].n} factura(s) ` +
        `con monto_pagado distinto de la suma de sus aplicaciones. Resuélvelas antes ` +
        `de migrar — marcarlas ahora ocultaría dinero sin aplicar.`,
      );
    }

    await qr.query(`
      UPDATE pago_aplicaciones
         SET aplicado_en = created_at
       WHERE aplicado_en IS NULL
    `);

    // Los pagos ya verificados y ya aplicados dejan de figurar como trabajo pendiente:
    // es lo que saca a los dos pagos existentes del bucle del reconciliador.
    await qr.query(`
      UPDATE pagos p
         SET aplicado_en = COALESCE(p.verificado_en, p.registrado_en)
       WHERE p.estado = 'verificado'
         AND p.aplicado_en IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM pago_aplicaciones pa
            WHERE pa.pago_id = p.id AND pa.aplicado_en IS NULL
         )
    `);

    // El reconciliador filtra por esta columna cada 10 minutos.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pago_aplicaciones_pendientes
        ON pago_aplicaciones (pago_id)
        WHERE aplicado_en IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_pago_aplicaciones_pendientes`);
    await qr.query(`ALTER TABLE pago_aplicaciones DROP COLUMN IF EXISTS aplicado_en`);
    // `pagos.aplicado_en` no se revierte: describe un hecho real (el dinero se aplicó),
    // y volver a ponerlo en NULL reabriría el bucle que esta migración cierra.
  }
}
