import { MigrationInterface, QueryRunner } from 'typeorm';

// Desviación A-4: la definición de "qué factura representa deuda" estaba escrita a mano en
// más de quince sitios, y no todos decían lo mismo. Esta migración cierra los dos que viven
// en la base de datos, que eran los más difíciles de ver — no aparecen en ningún `grep` del
// código que los consume.
//
//   1. `v_resumen_financiero.cuentas_por_cobrar` omitía `en_cobranza`.
//   2. `fn_calcular_deuda_contrato` tenía su propia lista, TAMBIÉN sin `en_cobranza`.
//
// Una factura en gestión de cobro seguía siendo dinero que el cliente debe para el cobro
// nocturno (que corta el servicio) y dejaba de serlo para el resumen financiero. Nadie
// falla; el ERP simplemente responde distinto según por dónde se le pregunte.
export class UnificarEstadosConSaldo1791800000046 implements MigrationInterface {
  name = 'UnificarEstadosConSaldo1791800000046';

  public async up(qr: QueryRunner): Promise<void> {
    // ── 1. La vista: añadir `en_cobranza` a cuentas por cobrar ────────────────
    //
    // Se redefine solo la columna afectada; el resto se reproduce igual porque
    // CREATE OR REPLACE VIEW exige la lista completa y en el mismo orden.
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

        -- Cuentas por cobrar: los CUATRO estados con saldo. Antes faltaba
        -- 'en_cobranza', así que el resumen financiero declaraba menos deuda de la
        -- que el propio ERP usaba para cortar el servicio.
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

    // ── 2. La función muerta ──────────────────────────────────────────────────
    //
    // `fn_calcular_deuda_contrato` no la invoca NADIE desde la aplicación (verificado con
    // `grep`: cero consumidores). Se retira en vez de corregirla: una definición divergente
    // que nadie usa no es código inofensivo, es una trampa esperando a que alguien la
    // encuentre y la crea autorizada. Además arrastraba el mismo defecto que
    // `pago.repository.calcularDeudaContrato` —solo `WHERE f.contrato_id = ...`, ciega al
    // comprobante consolidado—, así que quien la adoptara heredaría el incidente
    // 2026-08-04 completo.
    //
    // Si algún día hace falta calcular la deuda desde SQL puro, se expone
    // `DeudaPorContratoService` — que es donde vive la imputación proporcional.
    await qr.query(`DROP FUNCTION IF EXISTS fn_calcular_deuda_contrato(UUID)`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // La vista vuelve a su definición anterior (sin `en_cobranza`).
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
          WHERE p.fecha_pago = CURRENT_DATE AND p.estado = 'verificado'
        ) AS cobrado_hoy,
        SUM(f.saldo) FILTER (
          WHERE f.estado IN ('emitida', 'pagada_parcial', 'vencida')
        ) AS cuentas_por_cobrar,
        COUNT(f.id) FILTER (WHERE f.estado = 'vencida') AS facturas_vencidas,
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

    await qr.query(`
      CREATE OR REPLACE FUNCTION fn_calcular_deuda_contrato(p_contrato_id UUID)
      RETURNS TABLE(deuda_total DECIMAL, meses_deuda INTEGER, facturas_pendientes INTEGER) AS $$
      BEGIN
        RETURN QUERY
        SELECT
          COALESCE(SUM(f.saldo), 0)::DECIMAL,
          (COUNT(f.id) FILTER (WHERE f.estado IN ('vencida', 'emitida')))::INTEGER,
          (COUNT(f.id) FILTER (WHERE f.estado IN ('vencida', 'emitida', 'pagada_parcial')))::INTEGER
        FROM facturas f
        WHERE f.contrato_id = p_contrato_id
          AND f.estado IN ('emitida', 'pagada_parcial', 'vencida')
          AND f.deleted_at IS NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }
}
