import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Unifica los estados de clientes y contratos a 4 estados simétricos:
 *   PENDIENTE_INSTALACION | ACTIVO | SUSPENDIDO | BAJA_DEFINITIVA
 *
 * Mapeo de estados eliminados:
 *   EstadoCliente:  prospecto      → pendiente_instalacion
 *                   moroso         → suspendido
 *                   baja_temporal  → suspendido
 *
 *   EstadoContrato: suspendido_mora   → suspendido
 *                   suspendido_manual → suspendido
 *                   prorroga          → activo  (Opción A: sin cambio de estado)
 *                   baja_solicitada   → baja_definitiva
 *                   migrado           → baja_definitiva
 */
export class UnificarEstadosAbonados1785400000000 implements MigrationInterface {
  name = 'UnificarEstadosAbonados1785400000000';

  public async up(qr: QueryRunner): Promise<void> {
    // Eliminar vistas dependientes antes de alterar columnas de tipo ENUM
    await qr.query(`DROP VIEW IF EXISTS v_resumen_clientes`);

    // ── 1. Convertir columnas cliente a TEXT para poder cambiar el ENUM ──
    await qr.query(`ALTER TABLE clientes ALTER COLUMN estado TYPE TEXT`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_anterior TYPE TEXT`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_nuevo TYPE TEXT`);

    // ── 2. Migrar datos de clientes ──────────────────────────────────────
    await qr.query(`UPDATE clientes SET estado = 'pendiente_instalacion' WHERE estado = 'prospecto'`);
    await qr.query(`UPDATE clientes SET estado = 'suspendido' WHERE estado IN ('moroso', 'baja_temporal')`);

    await qr.query(`UPDATE clientes_historial_estados SET estado_anterior = 'pendiente_instalacion' WHERE estado_anterior = 'prospecto'`);
    await qr.query(`UPDATE clientes_historial_estados SET estado_anterior = 'suspendido' WHERE estado_anterior IN ('moroso', 'baja_temporal')`);
    await qr.query(`UPDATE clientes_historial_estados SET estado_nuevo = 'pendiente_instalacion' WHERE estado_nuevo = 'prospecto'`);
    await qr.query(`UPDATE clientes_historial_estados SET estado_nuevo = 'suspendido' WHERE estado_nuevo IN ('moroso', 'baja_temporal')`);

    // ── 3. Reemplazar enum estado_cliente ────────────────────────────────
    await qr.query(`DROP TYPE IF EXISTS estado_cliente`);
    await qr.query(`CREATE TYPE estado_cliente AS ENUM ('pendiente_instalacion', 'activo', 'suspendido', 'baja_definitiva')`);

    await qr.query(`ALTER TABLE clientes ALTER COLUMN estado TYPE estado_cliente USING estado::estado_cliente`);
    await qr.query(`ALTER TABLE clientes ALTER COLUMN estado SET DEFAULT 'pendiente_instalacion'`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_anterior TYPE estado_cliente USING estado_anterior::estado_cliente`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_nuevo TYPE estado_cliente USING estado_nuevo::estado_cliente`);

    // ── 4. Convertir columnas contrato a TEXT ────────────────────────────
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE TEXT`);

    // ── 5. Migrar datos de contratos ─────────────────────────────────────
    await qr.query(`UPDATE contratos SET estado = 'suspendido' WHERE estado IN ('suspendido_mora', 'suspendido_manual')`);
    await qr.query(`UPDATE contratos SET estado = 'activo'         WHERE estado = 'prorroga'`);
    await qr.query(`UPDATE contratos SET estado = 'baja_definitiva' WHERE estado IN ('baja_solicitada', 'migrado')`);

    await qr.query(`UPDATE contratos_historial SET estado_anterior = 'suspendido' WHERE estado_anterior IN ('suspendido_mora', 'suspendido_manual')`);
    await qr.query(`UPDATE contratos_historial SET estado_anterior = 'activo'          WHERE estado_anterior = 'prorroga'`);
    await qr.query(`UPDATE contratos_historial SET estado_anterior = 'baja_definitiva' WHERE estado_anterior IN ('baja_solicitada', 'migrado')`);
    await qr.query(`UPDATE contratos_historial SET estado_nuevo = 'suspendido' WHERE estado_nuevo IN ('suspendido_mora', 'suspendido_manual')`);
    await qr.query(`UPDATE contratos_historial SET estado_nuevo = 'activo'          WHERE estado_nuevo = 'prorroga'`);
    await qr.query(`UPDATE contratos_historial SET estado_nuevo = 'baja_definitiva' WHERE estado_nuevo IN ('baja_solicitada', 'migrado')`);

    // ── 6. Reemplazar enum estado_contrato ───────────────────────────────
    await qr.query(`DROP TYPE IF EXISTS estado_contrato`);
    await qr.query(`CREATE TYPE estado_contrato AS ENUM ('pendiente_instalacion', 'activo', 'suspendido', 'baja_definitiva')`);

    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE estado_contrato USING estado::estado_contrato`);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado SET DEFAULT 'pendiente_instalacion'`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE estado_contrato USING estado_anterior::estado_contrato`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE estado_contrato USING estado_nuevo::estado_contrato`);

    // ── 7. Actualizar vista v_resumen_clientes ───────────────────
    // La columna "morosos" deja de existir; se reemplaza por "pendiente_instalacion"
    await qr.query(`
      CREATE OR REPLACE VIEW v_resumen_clientes AS
      SELECT
        c.empresa_id,
        COUNT(*)                                                              AS total,
        COUNT(*) FILTER (WHERE c.estado = 'activo')                          AS activos,
        COUNT(*) FILTER (WHERE c.estado = 'suspendido')                      AS suspendidos,
        COUNT(*) FILTER (WHERE c.estado = 'pendiente_instalacion')           AS pendientes,
        COUNT(*) FILTER (WHERE c.estado = 'baja_definitiva')                 AS bajas,
        COUNT(*) FILTER (WHERE c.created_at >= DATE_TRUNC('month', NOW()))   AS nuevos_este_mes
      FROM clientes c
      WHERE c.deleted_at IS NULL
      GROUP BY c.empresa_id
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Eliminar vistas dependientes antes de alterar columnas de tipo ENUM
    await qr.query(`DROP VIEW IF EXISTS v_resumen_clientes`);

    // Revertir enum estado_contrato
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE TEXT`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE TEXT`);
    await qr.query(`DROP TYPE IF EXISTS estado_contrato`);
    await qr.query(`
      CREATE TYPE estado_contrato AS ENUM (
        'pendiente_instalacion','activo','suspendido_mora','suspendido_manual',
        'prorroga','baja_solicitada','baja_definitiva','migrado'
      )
    `);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado TYPE estado_contrato USING estado::estado_contrato`);
    await qr.query(`ALTER TABLE contratos ALTER COLUMN estado SET DEFAULT 'pendiente_instalacion'`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_anterior TYPE estado_contrato USING estado_anterior::estado_contrato`);
    await qr.query(`ALTER TABLE contratos_historial ALTER COLUMN estado_nuevo TYPE estado_contrato USING estado_nuevo::estado_contrato`);

    // Revertir enum estado_cliente
    await qr.query(`ALTER TABLE clientes ALTER COLUMN estado TYPE TEXT`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_anterior TYPE TEXT`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_nuevo TYPE TEXT`);
    await qr.query(`DROP TYPE IF EXISTS estado_cliente`);
    await qr.query(`
      CREATE TYPE estado_cliente AS ENUM (
        'activo','suspendido','moroso','baja_temporal','baja_definitiva','prospecto'
      )
    `);
    await qr.query(`ALTER TABLE clientes ALTER COLUMN estado TYPE estado_cliente USING estado::estado_cliente`);
    await qr.query(`ALTER TABLE clientes ALTER COLUMN estado SET DEFAULT 'prospecto'`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_anterior TYPE estado_cliente USING estado_anterior::estado_cliente`);
    await qr.query(`ALTER TABLE clientes_historial_estados ALTER COLUMN estado_nuevo TYPE estado_cliente USING estado_nuevo::estado_cliente`);

    // Restaurar vista v_resumen_clientes con columna morosos
    await qr.query(`
      CREATE OR REPLACE VIEW v_resumen_clientes AS
      SELECT
        c.empresa_id,
        COUNT(*)                                                            AS total,
        COUNT(*) FILTER (WHERE c.estado = 'activo')                        AS activos,
        COUNT(*) FILTER (WHERE c.estado = 'suspendido')                    AS suspendidos,
        COUNT(*) FILTER (WHERE c.estado = 'moroso')                        AS morosos,
        COUNT(*) FILTER (WHERE c.estado = 'baja_definitiva')               AS bajas,
        COUNT(*) FILTER (WHERE c.created_at >= DATE_TRUNC('month', NOW())) AS nuevos_este_mes
      FROM clientes c
      WHERE c.deleted_at IS NULL
      GROUP BY c.empresa_id
    `);
  }
}
