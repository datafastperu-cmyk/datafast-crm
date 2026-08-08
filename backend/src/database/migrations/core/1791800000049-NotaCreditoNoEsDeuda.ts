import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Una NOTA DE CRÉDITO no es deuda del abonado (hallazgo 2026-08-08).
 *
 * `v_resumen_financiero.cuentas_por_cobrar` suma el saldo de los cuatro estados con saldo
 * sin mirar QUÉ documento es cada fila. Y una nota de crédito es una fila más de
 * `facturas`: la emite `crearNotaCredito` con estado `emitida`, `total` positivo —el CHECK
 * `facturas_total_check (total >= 0)` impide que sea negativo—, `monto_pagado = 0` y, por
 * tanto, `saldo` positivo, porque `saldo` es `GENERATED ALWAYS AS (total - monto_pagado)`.
 *
 * Resultado: anular una factura de S/ 50 no bajaba las cuentas por cobrar. La original
 * salía al pasar a `anulada` y su propia nota de crédito entraba por el mismo importe.
 *
 * El discriminante es `factura_original_id`: solo lo lleva un documento que rectifica a
 * otro. Es la misma condición que aplica `sqlDeudaExigible()` en el código, y está escrita
 * aquí literal a propósito —igual que la lista de estados— porque una vista de BD no puede
 * cambiar de significado cuando cambie una constante de TypeScript.
 *
 * Nada que corregir en los datos: al aplicar esta migración había CERO notas de crédito y
 * CERO facturas anuladas en producción. El defecto estaba latente.
 */
export class NotaCreditoNoEsDeuda1791800000049 implements MigrationInterface {
  name = 'NotaCreditoNoEsDeuda1791800000049';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE OR REPLACE VIEW v_resumen_financiero AS
      SELECT
        f.empresa_id,

        SUM(f.total) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision) = DATE_TRUNC('month', NOW())
        ) AS facturado_mes_actual,

        SUM(f.monto_pagado) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision) = DATE_TRUNC('month', NOW())
        ) AS cobrado_mes_actual,

        SUM(p.monto) FILTER (
          WHERE p.fecha_pago = CURRENT_DATE
            AND p.estado = 'verificado'
        ) AS cobrado_hoy,

        -- Cuentas por cobrar: los CUATRO estados con saldo, Y solo documentos de CARGO.
        -- Una nota de crédito (\`factura_original_id\` no nulo) es un abono: nace con saldo
        -- positivo por el CHECK que prohíbe importes negativos, y sumarla convertía el
        -- descargo en una deuda nueva por el mismo importe.
        SUM(f.saldo) FILTER (
          WHERE f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
            AND f.factura_original_id IS NULL
        ) AS cuentas_por_cobrar,

        COUNT(f.id) FILTER (
          WHERE f.estado = 'vencida'
            AND f.factura_original_id IS NULL
        ) AS facturas_vencidas,

        SUM(p.monto) FILTER (
          WHERE DATE_TRUNC('month', p.fecha_pago) =
                DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
            AND p.estado = 'verificado'
        ) AS cobrado_mes_anterior

      FROM facturas f
      LEFT JOIN pagos p ON p.empresa_id = f.empresa_id
      WHERE f.deleted_at IS NULL
      GROUP BY f.empresa_id
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Vuelve a contar las notas de crédito como deuda (estado anterior a esta migración).
    await qr.query(`
      CREATE OR REPLACE VIEW v_resumen_financiero AS
      SELECT
        f.empresa_id,
        SUM(f.total) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision) = DATE_TRUNC('month', NOW())
        ) AS facturado_mes_actual,
        SUM(f.monto_pagado) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision) = DATE_TRUNC('month', NOW())
        ) AS cobrado_mes_actual,
        SUM(p.monto) FILTER (
          WHERE p.fecha_pago = CURRENT_DATE
            AND p.estado = 'verificado'
        ) AS cobrado_hoy,
        SUM(f.saldo) FILTER (
          WHERE f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
        ) AS cuentas_por_cobrar,
        COUNT(f.id) FILTER (
          WHERE f.estado = 'vencida'
        ) AS facturas_vencidas,
        SUM(p.monto) FILTER (
          WHERE DATE_TRUNC('month', p.fecha_pago) =
                DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
            AND p.estado = 'verificado'
        ) AS cobrado_mes_anterior
      FROM facturas f
      LEFT JOIN pagos p ON p.empresa_id = f.empresa_id
      WHERE f.deleted_at IS NULL
      GROUP BY f.empresa_id
    `);
  }
}
