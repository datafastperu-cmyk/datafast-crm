import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retira `v_contratos_completos` y `v_resumen_financiero` (Ola 4, censo de deuda,
 * 2026-08-18) — cero consumidores de aplicación verificados.
 *
 * Verificación hecha antes de tocarlas, no supuesta: grep de `v_resumen_financiero` y
 * `v_contratos_completos` en `backend/src` (excluyendo migrations/*.spec.ts), `frontend/`
 * y `scripts/` (raíz e `installer/`). Cero resultados en código de aplicación en los tres.
 * La única mención fuera de una migración era un comentario en
 * `facturacion/domain/estados-con-saldo.ts` documentando que la vista debía coincidir
 * conceptualmente con la constante de TypeScript — nunca una lectura.
 *
 * `v_contratos_completos` ya estaba señalada en DOM-001 como candidata a no recrearse en
 * la instalación limpia: "irreversible y sin ganancia funcional, porque ya no hay código
 * que la nombre". Esta migración ejecuta lo que ese documento ya anticipaba.
 *
 * `v_resumen_financiero` es el caso menos obvio: se corrigió dos veces en 2026-08-08
 * (nota de crédito, `en_cobranza`) sin que nadie volviera a verificar si algo la leía. No
 * se puede afirmar desde este repo si alimentaba un proceso externo (BI, consulta manual) —
 * el censo lo registra como ambiguo, no como comprobado. Se retira igual porque una vista
 * sin consumidor de aplicación es, literalmente, una segunda definición de deuda esperando
 * a que alguien la crea vigente (R-3) — y si algo externo la necesitaba, el `down()` la
 * restaura sin pérdida de datos: es una vista, no una tabla.
 *
 * `v_resumen_clientes` NO se toca: no forma parte de este censo (no calcula deuda) y no se
 * verificó su consumo.
 */
export class RetirarVistasDeudaSinConsumidor1791800000071 implements MigrationInterface {
  name = 'RetirarVistasDeudaSinConsumidor1791800000071';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP VIEW IF EXISTS v_contratos_completos`);
    await qr.query(`DROP VIEW IF EXISTS v_resumen_financiero`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Definición vigente al momento del retiro (post nota-de-crédito, post en_cobranza —
    // 1791800000049). Restaura la vista, no reintroduce consumidores.
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

    // v_contratos_completos dependía del tipo estado_contrato tal como existía antes de
    // que la Ola 1 retirara el valor 'moroso' (DOM-001). No se reconstruye con exactitud
    // porque nada la consumía ni siquiera antes del retiro del enum: recrearla con la
    // forma actual de `servicios` es la restauración honesta, no una réplica arqueológica.
    await qr.query(`
      CREATE OR REPLACE VIEW v_contratos_completos AS
      SELECT
        co.id,
        co.empresa_id,
        co.numero_contrato,
        co.estado,
        co.fecha_inicio,
        co.fecha_vencimiento,
        co.precio_final,
        co.deuda_total,
        co.meses_deuda,
        co.en_prorroga,
        co.prorroga_hasta,
        co.ip_asignada,
        co.usuario_pppoe,
        co.aprovisionado,
        co.created_at,
        cl.id              AS cliente_id,
        cl.nombre_completo AS cliente_nombre,
        cl.numero_documento AS cliente_dni,
        cl.telefono        AS cliente_telefono,
        cl.email           AS cliente_email,
        cl.direccion       AS cliente_direccion,
        cl.latitud         AS cliente_lat,
        cl.longitud        AS cliente_lng,
        pl.id              AS plan_id,
        pl.nombre          AS plan_nombre,
        pl.velocidad_bajada,
        pl.velocidad_subida,
        pl.tipo_queue,
        ro.id              AS router_id,
        ro.nombre          AS router_nombre,
        ro.ip_gestion      AS router_ip,
        ro.estado          AS router_estado,
        on2.id             AS onu_id,
        on2.serial_number  AS onu_serial,
        on2.estado         AS onu_estado,
        on2.rx_power_dbm   AS onu_rx_power
      FROM servicios co
      JOIN  clientes cl ON cl.id = co.cliente_id
      JOIN  planes   pl ON pl.id = co.plan_id
      LEFT JOIN routers ro ON ro.id = co.router_id
      LEFT JOIN onus   on2 ON on2.id = co.onu_id
      WHERE co.deleted_at IS NULL
    `);
  }
}
