import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 011 — Vistas, funciones y mantenimiento
// Vistas SQL para el dashboard, funciones de negocio y
// configuración de mantenimiento automático de la BD.
// ─────────────────────────────────────────────────────────────
export class CreateViewsAndFunctions1700000011000 implements MigrationInterface {
  name = 'CreateViewsAndFunctions1700000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── Vista: Resumen de clientes por empresa ─────────────────
    await queryRunner.query(`
      CREATE OR REPLACE VIEW v_resumen_clientes AS
      SELECT
        c.empresa_id,
        COUNT(*)                                      AS total,
        COUNT(*) FILTER (WHERE c.estado = 'activo')   AS activos,
        COUNT(*) FILTER (WHERE c.estado = 'suspendido') AS suspendidos,
        COUNT(*) FILTER (WHERE c.estado = 'moroso')   AS morosos,
        COUNT(*) FILTER (WHERE c.estado = 'baja_definitiva') AS bajas,
        COUNT(*) FILTER (
          WHERE c.created_at >= DATE_TRUNC('month', NOW())
        ) AS nuevos_este_mes
      FROM clientes c
      WHERE c.deleted_at IS NULL
      GROUP BY c.empresa_id
    `);

    // ── Vista: Resumen financiero por empresa ──────────────────
    await queryRunner.query(`
      CREATE OR REPLACE VIEW v_resumen_financiero AS
      SELECT
        f.empresa_id,

        -- Mes actual
        SUM(f.total) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision) = DATE_TRUNC('month', NOW())
        ) AS facturado_mes_actual,

        SUM(f.monto_pagado) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision) = DATE_TRUNC('month', NOW())
        ) AS cobrado_mes_actual,

        -- Hoy
        SUM(p.monto) FILTER (
          WHERE p.fecha_pago = CURRENT_DATE
            AND p.estado = 'verificado'
        ) AS cobrado_hoy,

        -- Cuentas por cobrar
        SUM(f.saldo) FILTER (
          WHERE f.estado IN ('emitida', 'pagada_parcial', 'vencida')
        ) AS cuentas_por_cobrar,

        -- Facturas vencidas
        COUNT(f.id) FILTER (
          WHERE f.estado = 'vencida'
        ) AS facturas_vencidas,

        -- Mes anterior
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

    // ── Vista: Contratos con datos completos (para listados) ───
    await queryRunner.query(`
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

        -- Cliente
        cl.id              AS cliente_id,
        cl.nombre_completo AS cliente_nombre,
        cl.numero_documento AS cliente_dni,
        cl.telefono        AS cliente_telefono,
        cl.email           AS cliente_email,
        cl.direccion       AS cliente_direccion,
        cl.latitud         AS cliente_lat,
        cl.longitud        AS cliente_lng,

        -- Plan
        pl.id              AS plan_id,
        pl.nombre          AS plan_nombre,
        pl.velocidad_bajada,
        pl.velocidad_subida,
        pl.tipo_queue,

        -- Router
        ro.id              AS router_id,
        ro.nombre          AS router_nombre,
        ro.ip_gestion      AS router_ip,
        ro.estado          AS router_estado,

        -- ONU
        on2.id             AS onu_id,
        on2.serial_number  AS onu_serial,
        on2.estado         AS onu_estado,
        on2.rx_power_dbm   AS onu_rx_power

      FROM contratos co
      JOIN  clientes cl ON cl.id = co.cliente_id
      JOIN  planes   pl ON pl.id = co.plan_id
      LEFT JOIN routers ro ON ro.id = co.router_id
      LEFT JOIN onus   on2 ON on2.id = co.onu_id
      WHERE co.deleted_at IS NULL
    `);

    // ── Función: Obtener próxima IP disponible en un segmento ──
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_next_available_ip(
        p_segmento_id UUID,
        p_ips_reservadas INET[] DEFAULT ARRAY[]::INET[]
      )
      RETURNS INET AS $$
      DECLARE
        v_red_cidr     CIDR;
        v_gateway      INET;
        v_host         INET;
        v_host_int     BIGINT;
        v_net_int      BIGINT;
        v_broadcast    INET;
        v_prefix_len   INTEGER;
        v_max_int      BIGINT;
      BEGIN
        SELECT red_cidr, gateway
        INTO v_red_cidr, v_gateway
        FROM segmentos_ipv4
        WHERE id = p_segmento_id AND deleted_at IS NULL AND activo = TRUE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Segmento no encontrado: %', p_segmento_id;
        END IF;

        v_prefix_len := masklen(v_red_cidr);
        v_net_int    := (network(v_red_cidr)::text::bigint);  -- simplificado
        v_max_int    := v_net_int + (2 ^ (32 - v_prefix_len))::BIGINT - 1;

        -- Iterar desde la primera IP usable (network + 1)
        v_host_int := v_net_int + 1;

        WHILE v_host_int < v_max_int LOOP
          v_host := v_host_int::text::inet;

          -- Saltar gateway, broadcast y reservadas
          CONTINUE WHEN v_host = v_gateway;
          CONTINUE WHEN v_host = ANY(p_ips_reservadas);

          -- Verificar si no está asignada
          IF NOT EXISTS (
            SELECT 1 FROM ips_asignadas
            WHERE segmento_id = p_segmento_id
              AND ip_address = v_host
              AND activa = TRUE
          ) THEN
            RETURN v_host;
          END IF;

          v_host_int := v_host_int + 1;
        END LOOP;

        RETURN NULL;  -- Pool exhausto
      END;
      $$ LANGUAGE plpgsql;

      COMMENT ON FUNCTION fn_next_available_ip IS
        'Retorna la próxima IP disponible en un segmento, excluyendo gateway y reservadas';
    `);

    // ── Función: Generar número de contrato ────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_generar_numero_contrato(
        p_empresa_id UUID
      )
      RETURNS VARCHAR AS $$
      DECLARE
        v_year    VARCHAR(4);
        v_seq     INTEGER;
        v_numero  VARCHAR(30);
      BEGIN
        v_year := TO_CHAR(NOW(), 'YYYY');

        SELECT COUNT(*) + 1
        INTO v_seq
        FROM contratos
        WHERE empresa_id = p_empresa_id
          AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());

        v_numero := 'CNT-' || v_year || '-' || LPAD(v_seq::text, 6, '0');
        RETURN v_numero;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ── Función: Generar número de ticket ─────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_generar_numero_ticket(
        p_empresa_id UUID
      )
      RETURNS VARCHAR AS $$
      DECLARE
        v_year   VARCHAR(4);
        v_seq    INTEGER;
      BEGIN
        v_year := TO_CHAR(NOW(), 'YYYY');
        SELECT COUNT(*) + 1 INTO v_seq
        FROM tickets
        WHERE empresa_id = p_empresa_id
          AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
        RETURN 'TKT-' || v_year || '-' || LPAD(v_seq::text, 6, '0');
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ── Función: Calcular deuda de un contrato ─────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_calcular_deuda_contrato(
        p_contrato_id UUID
      )
      RETURNS TABLE(deuda_total DECIMAL, meses_deuda INTEGER, facturas_pendientes INTEGER) AS $$
      BEGIN
        RETURN QUERY
        SELECT
          COALESCE(SUM(f.saldo), 0)::DECIMAL,
          COUNT(f.id)::INTEGER FILTER (WHERE f.estado IN ('vencida', 'emitida')),
          COUNT(f.id)::INTEGER FILTER (WHERE f.estado IN ('vencida', 'emitida', 'pagada_parcial'))
        FROM facturas f
        WHERE f.contrato_id = p_contrato_id
          AND f.estado IN ('emitida', 'pagada_parcial', 'vencida')
          AND f.deleted_at IS NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ── Función: Trigger para actualizar ips_usadas en segmento ─
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_update_ips_usadas()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' AND NEW.activa = TRUE THEN
          UPDATE segmentos_ipv4
          SET ips_usadas = ips_usadas + 1
          WHERE id = NEW.segmento_id;

        ELSIF TG_OP = 'UPDATE' THEN
          IF OLD.activa = TRUE AND NEW.activa = FALSE THEN
            UPDATE segmentos_ipv4
            SET ips_usadas = GREATEST(ips_usadas - 1, 0)
            WHERE id = NEW.segmento_id;
          ELSIF OLD.activa = FALSE AND NEW.activa = TRUE THEN
            UPDATE segmentos_ipv4
            SET ips_usadas = ips_usadas + 1
            WHERE id = NEW.segmento_id;
          END IF;

        ELSIF TG_OP = 'DELETE' AND OLD.activa = TRUE THEN
          UPDATE segmentos_ipv4
          SET ips_usadas = GREATEST(ips_usadas - 1, 0)
          WHERE id = OLD.segmento_id;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_update_ips_usadas
        AFTER INSERT OR UPDATE OR DELETE ON ips_asignadas
        FOR EACH ROW EXECUTE FUNCTION fn_update_ips_usadas();
    `);

    // ── Configuración de autovacuum para tablas grandes ────────
    // nodos_mediciones y consumo_datos crecen muy rápido
    await queryRunner.query(`
      ALTER TABLE nodos_mediciones SET (
        autovacuum_vacuum_scale_factor = 0.01,
        autovacuum_analyze_scale_factor = 0.005,
        autovacuum_vacuum_cost_delay = 2
      );

      ALTER TABLE consumo_datos SET (
        autovacuum_vacuum_scale_factor = 0.01,
        autovacuum_analyze_scale_factor = 0.005
      );

      ALTER TABLE auditoria_logs SET (
        autovacuum_vacuum_scale_factor = 0.02
      );
    `);

    // ── Función de limpieza de datos viejos (ejecutar con pg_cron) ─
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_cleanup_old_data()
      RETURNS void AS $$
      BEGIN
        -- Eliminar mediciones de monitoreo > 90 días
        DELETE FROM nodos_mediciones
        WHERE medido_en < NOW() - INTERVAL '90 days';

        -- Eliminar logs de auditoría > 1 año
        DELETE FROM auditoria_logs
        WHERE created_at < NOW() - INTERVAL '1 year'
          AND accion NOT IN ('DELETE', 'LOGIN_FAIL');

        -- Eliminar notificaciones enviadas > 6 meses
        DELETE FROM notificaciones
        WHERE estado = 'enviada'
          AND created_at < NOW() - INTERVAL '6 months';

        RAISE NOTICE 'Limpieza de datos completada: %', NOW();
      END;
      $$ LANGUAGE plpgsql;

      COMMENT ON FUNCTION fn_cleanup_old_data IS
        'Limpieza periódica de datos históricos. Ejecutar con: SELECT fn_cleanup_old_data()';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_cleanup_old_data CASCADE`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_update_ips_usadas ON ips_asignadas`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_update_ips_usadas CASCADE`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_calcular_deuda_contrato CASCADE`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_generar_numero_ticket CASCADE`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_generar_numero_contrato CASCADE`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_next_available_ip CASCADE`);
    await queryRunner.query(`DROP VIEW IF EXISTS v_contratos_completos CASCADE`);
    await queryRunner.query(`DROP VIEW IF EXISTS v_resumen_financiero CASCADE`);
    await queryRunner.query(`DROP VIEW IF EXISTS v_resumen_clientes CASCADE`);
  }
}
