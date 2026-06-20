import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega dos estados al ciclo de vida del contrato:
 *   moroso  — cliente con deuda activa pero aún con servicio (dentro del período de gracia)
 *   cortado — cliente sin servicio por deuda vencida (post-prorroga), hardware desprovisioado
 *
 * El flujo de mora es:
 *   ACTIVO → MOROSO (cron detecta deuda + se agota prorroga)
 *   MOROSO → CORTADO (cron dispara corte: deprovision hardware + suspensión firewall)
 *   CORTADO → ACTIVO (pago recibido: re-provision hardware)
 *
 * La migración replica el patrón de UnificarEstadosAbonados:
 *   1. Eliminar vistas dependientes
 *   2. Convertir columna a TEXT
 *   3. DROP + CREATE TYPE con nuevos valores
 *   4. Restaurar columna y vistas
 */
export class AddMorosoCorteEstados1788000000000 implements MigrationInterface {
  name = 'AddMorosoCorteEstados1788000000000';

  public async up(qr: QueryRunner): Promise<void> {
    // 1. Eliminar vistas e índices parciales que referencian el tipo estado_contrato
    //    (tanto en predicados WHERE como en columnas indexadas del tipo enum)
    await qr.query(`DROP VIEW IF EXISTS v_contratos_completos`);
    await qr.query(`DROP VIEW IF EXISTS v_resumen_clientes`);
    await qr.query(`DROP INDEX IF EXISTS idx_contratos_mora`);
    // Estos 4 índices tienen predicados WHERE con ::estado_contrato y bloquean el ALTER TYPE
    await qr.query(`DROP INDEX IF EXISTS uq_contratos_empresa_pppoe`);
    await qr.query(`DROP INDEX IF EXISTS uq_contratos_empresa_mac`);
    await qr.query(`DROP INDEX IF EXISTS uq_contratos_empresa_ip`);
    await qr.query(`DROP INDEX IF EXISTS idx_contratos_cliente_tipo_servicio`);

    // 2. Convertir columnas a TEXT para poder alterar el tipo
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado DROP DEFAULT`);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE TEXT`);

    // 3. Reemplazar el enum con los nuevos valores
    await qr.query(`DROP TYPE IF EXISTS estado_contrato CASCADE`);
    await qr.query(`
      CREATE TYPE estado_contrato AS ENUM (
        'pendiente_activacion',
        'activo',
        'suspendido',
        'moroso',
        'cortado',
        'baja_definitiva'
      )
    `);

    // 4. Restaurar columnas al nuevo tipo
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE estado_contrato USING estado::estado_contrato`);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado SET DEFAULT 'pendiente_activacion'`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE estado_contrato USING estado_anterior::estado_contrato`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE estado_contrato USING estado_nuevo::estado_contrato`);

    // 5. Recrear todos los índices que dependen del tipo
    await qr.query(`
      CREATE INDEX idx_contratos_mora
        ON contratos USING btree (empresa_id, estado, deuda_total)
        WHERE estado IN ('activo', 'suspendido', 'moroso', 'cortado')
          AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX uq_contratos_empresa_pppoe
        ON contratos (empresa_id, usuario_pppoe)
        WHERE usuario_pppoe IS NOT NULL
          AND estado <> 'baja_definitiva'
          AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX uq_contratos_empresa_mac
        ON contratos (empresa_id, mac_address)
        WHERE mac_address IS NOT NULL
          AND estado <> 'baja_definitiva'
          AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX uq_contratos_empresa_ip
        ON contratos (empresa_id, ip_asignada)
        WHERE ip_asignada IS NOT NULL
          AND estado <> 'baja_definitiva'
          AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX idx_contratos_cliente_tipo_servicio
        ON contratos (cliente_id, tipo_servicio)
        WHERE deleted_at IS NULL
          AND estado <> 'baja_definitiva'
    `);

    // 6. Recrear vistas
    await qr.query(`
      CREATE OR REPLACE VIEW v_resumen_clientes AS
      SELECT
        c.empresa_id,
        COUNT(*)                                                              AS total,
        COUNT(*) FILTER (WHERE c.estado = 'activo')                          AS activos,
        COUNT(*) FILTER (WHERE c.estado = 'suspendido')                      AS suspendidos,
        COUNT(*) FILTER (WHERE c.estado = 'pendiente_activacion')            AS pendientes,
        COUNT(*) FILTER (WHERE c.estado = 'baja_definitiva')                 AS bajas,
        COUNT(*) FILTER (WHERE c.created_at >= DATE_TRUNC('month', NOW()))   AS nuevos_este_mes
      FROM clientes c
      WHERE c.deleted_at IS NULL
      GROUP BY c.empresa_id
    `);

    await qr.query(`
      CREATE OR REPLACE VIEW v_contratos_completos AS
      SELECT
        co.id, co.empresa_id, co.numero_contrato, co.estado,
        co.fecha_inicio, co.fecha_vencimiento, co.precio_final,
        co.deuda_total, co.meses_deuda, co.en_prorroga, co.prorroga_hasta,
        co.ip_asignada, co.usuario_pppoe, co.aprovisionado, co.created_at,
        cl.id               AS cliente_id,
        cl.nombre_completo  AS cliente_nombre,
        cl.numero_documento AS cliente_dni,
        cl.telefono         AS cliente_telefono,
        cl.email            AS cliente_email,
        cl.direccion        AS cliente_direccion,
        cl.latitud          AS cliente_lat,
        cl.longitud         AS cliente_lng,
        pl.id               AS plan_id,
        pl.nombre           AS plan_nombre,
        pl.velocidad_bajada, pl.velocidad_subida, pl.tipo_queue,
        ro.id               AS router_id,
        ro.nombre           AS router_nombre,
        ro.ip_gestion       AS router_ip,
        ro.estado           AS router_estado,
        on2.id              AS onu_id,
        on2.serial_number   AS onu_serial,
        on2.estado          AS onu_estado,
        on2.rx_power_dbm    AS onu_rx_power
      FROM contratos co
        JOIN clientes cl  ON cl.id  = co.cliente_id
        JOIN planes   pl  ON pl.id  = co.plan_id
        LEFT JOIN routers ro  ON ro.id  = co.router_id
        LEFT JOIN onus    on2 ON on2.id = co.onu_id
      WHERE co.deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP VIEW IF EXISTS v_contratos_completos`);
    await qr.query(`DROP VIEW IF EXISTS v_resumen_clientes`);
    await qr.query(`DROP INDEX IF EXISTS idx_contratos_mora`);
    await qr.query(`DROP INDEX IF EXISTS uq_contratos_empresa_pppoe`);
    await qr.query(`DROP INDEX IF EXISTS uq_contratos_empresa_mac`);
    await qr.query(`DROP INDEX IF EXISTS uq_contratos_empresa_ip`);
    await qr.query(`DROP INDEX IF EXISTS idx_contratos_cliente_tipo_servicio`);

    // Migrar moroso→suspendido, cortado→suspendido antes de eliminar los valores del enum
    await qr.query(`UPDATE contratos SET estado = 'suspendido' WHERE estado IN ('moroso', 'cortado')`);
    await qr.query(`UPDATE contratos_historial SET estado_anterior = 'suspendido' WHERE estado_anterior IN ('moroso', 'cortado')`);
    await qr.query(`UPDATE contratos_historial SET estado_nuevo = 'suspendido' WHERE estado_nuevo IN ('moroso', 'cortado')`);

    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado DROP DEFAULT`);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE TEXT`);
    await qr.query(`DROP TYPE IF EXISTS estado_contrato CASCADE`);
    await qr.query(`CREATE TYPE estado_contrato AS ENUM ('pendiente_activacion', 'activo', 'suspendido', 'baja_definitiva')`);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE estado_contrato USING estado::estado_contrato`);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado SET DEFAULT 'pendiente_activacion'`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE estado_contrato USING estado_anterior::estado_contrato`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE estado_contrato USING estado_nuevo::estado_contrato`);

    await qr.query(`
      CREATE INDEX idx_contratos_mora
        ON contratos USING btree (empresa_id, estado, deuda_total)
        WHERE estado IN ('activo', 'suspendido') AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX uq_contratos_empresa_pppoe
        ON contratos (empresa_id, usuario_pppoe)
        WHERE usuario_pppoe IS NOT NULL AND estado <> 'baja_definitiva' AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX uq_contratos_empresa_mac
        ON contratos (empresa_id, mac_address)
        WHERE mac_address IS NOT NULL AND estado <> 'baja_definitiva' AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE UNIQUE INDEX uq_contratos_empresa_ip
        ON contratos (empresa_id, ip_asignada)
        WHERE ip_asignada IS NOT NULL AND estado <> 'baja_definitiva' AND deleted_at IS NULL
    `);
    await qr.query(`
      CREATE INDEX idx_contratos_cliente_tipo_servicio
        ON contratos (cliente_id, tipo_servicio)
        WHERE deleted_at IS NULL AND estado <> 'baja_definitiva'
    `);

    await qr.query(`
      CREATE OR REPLACE VIEW v_resumen_clientes AS
      SELECT
        c.empresa_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE c.estado = 'activo') AS activos,
        COUNT(*) FILTER (WHERE c.estado = 'suspendido') AS suspendidos,
        COUNT(*) FILTER (WHERE c.estado = 'pendiente_activacion') AS pendientes,
        COUNT(*) FILTER (WHERE c.estado = 'baja_definitiva') AS bajas,
        COUNT(*) FILTER (WHERE c.created_at >= DATE_TRUNC('month', NOW())) AS nuevos_este_mes
      FROM clientes c WHERE c.deleted_at IS NULL GROUP BY c.empresa_id
    `);

    await qr.query(`
      CREATE OR REPLACE VIEW v_contratos_completos AS
      SELECT co.id, co.empresa_id, co.numero_contrato, co.estado,
        co.fecha_inicio, co.fecha_vencimiento, co.precio_final,
        co.deuda_total, co.meses_deuda, co.en_prorroga, co.prorroga_hasta,
        co.ip_asignada, co.usuario_pppoe, co.aprovisionado, co.created_at,
        cl.id AS cliente_id, cl.nombre_completo AS cliente_nombre,
        cl.numero_documento AS cliente_dni, cl.telefono AS cliente_telefono,
        cl.email AS cliente_email, cl.direccion AS cliente_direccion,
        cl.latitud AS cliente_lat, cl.longitud AS cliente_lng,
        pl.id AS plan_id, pl.nombre AS plan_nombre,
        pl.velocidad_bajada, pl.velocidad_subida, pl.tipo_queue,
        ro.id AS router_id, ro.nombre AS router_nombre,
        ro.ip_gestion AS router_ip, ro.estado AS router_estado,
        on2.id AS onu_id, on2.serial_number AS onu_serial,
        on2.estado AS onu_estado, on2.rx_power_dbm AS onu_rx_power
      FROM contratos co
        JOIN clientes cl ON cl.id = co.cliente_id
        JOIN planes pl ON pl.id = co.plan_id
        LEFT JOIN routers ro ON ro.id = co.router_id
        LEFT JOIN onus on2 ON on2.id = co.onu_id
      WHERE co.deleted_at IS NULL
    `);
  }
}
