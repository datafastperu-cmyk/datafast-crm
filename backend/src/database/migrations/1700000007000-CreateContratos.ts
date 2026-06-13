import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 007 — Contratos
// Tabla central que une: cliente + plan + router + ONU + IP.
// Un cliente puede tener múltiples contratos (multi-servicio).
// ─────────────────────────────────────────────────────────────
export class CreateContratos1700000007000 implements MigrationInterface {
  name = 'CreateContratos1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      CREATE TYPE estado_contrato AS ENUM (
        'pendiente_instalacion',
        'activo',
        'suspendido_mora',
        'suspendido_manual',
        'prorroga',
        'baja_solicitada',
        'baja_definitiva',
        'migrado'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE contratos (
        id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id          UUID          NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
        plan_id             UUID          NOT NULL REFERENCES planes(id) ON DELETE RESTRICT,
        router_id           UUID          REFERENCES routers(id) ON DELETE SET NULL,
        nodo_id             UUID          REFERENCES nodos(id) ON DELETE SET NULL,
        onu_id              UUID          REFERENCES onus(id) ON DELETE SET NULL,
        segmento_id         UUID          REFERENCES segmentos_ipv4(id) ON DELETE SET NULL,
        tecnico_instalacion UUID          REFERENCES usuarios(id) ON DELETE SET NULL,
        vendedor_id         UUID          REFERENCES usuarios(id) ON DELETE SET NULL,

        -- Código
        numero_contrato     VARCHAR(30)   NOT NULL,  -- ej: CNT-2024-000123

        -- Estado
        estado              estado_contrato NOT NULL DEFAULT 'pendiente_instalacion',
        fecha_estado        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        motivo_estado       TEXT,

        -- Vigencia
        fecha_inicio        DATE           NOT NULL,
        fecha_vencimiento   DATE,          -- NULL = indefinido
        fecha_instalacion   TIMESTAMPTZ,
        fecha_baja          DATE,
        motivo_baja         TEXT,

        -- Dirección de instalación (puede diferir de la del cliente)
        direccion_instalacion TEXT,
        latitud_instalacion   DECIMAL(10,7),
        longitud_instalacion  DECIMAL(10,7),

        -- ── Red PPPoE ─────────────────────────────────────────
        usuario_pppoe       VARCHAR(100),
        password_pppoe      VARCHAR(500),  -- cifrado AES-256
        ip_asignada         INET,
        mac_address         MACADDR,

        -- ── VLAN (puede diferir del plan para casos especiales) ─
        vlan_id             SMALLINT       CHECK (vlan_id BETWEEN 1 AND 4094),

        -- Mikrotik — nombre de la queue creada
        nombre_queue        VARCHAR(100),
        ip_mikrotik_asignada INET,         -- IP remota asignada en Mikrotik

        -- ── Precio (al momento de contratar, puede diferir del plan) ─
        precio_mensual      DECIMAL(10,2)  NOT NULL,
        descuento_pct       DECIMAL(5,2)   DEFAULT 0.00
                              CHECK (descuento_pct BETWEEN 0 AND 100),
        descuento_motivo    VARCHAR(200),
        precio_final        DECIMAL(10,2)  GENERATED ALWAYS AS (
                              precio_mensual * (1 - COALESCE(descuento_pct, 0) / 100)
                            ) STORED,

        -- ── Prórrogas ─────────────────────────────────────────
        en_prorroga         BOOLEAN        NOT NULL DEFAULT FALSE,
        prorroga_hasta      DATE,
        prorroga_motivo     TEXT,
        prorroga_otorgada_por UUID REFERENCES usuarios(id),

        -- ── Facturación ───────────────────────────────────────
        dia_facturacion     SMALLINT       CHECK (dia_facturacion BETWEEN 1 AND 28),
        fecha_ultimo_pago   DATE,
        deuda_total         DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
        meses_deuda         SMALLINT       NOT NULL DEFAULT 0,

        -- ── Aprovisionamiento FTTH ────────────────────────────
        aprovisionado       BOOLEAN        NOT NULL DEFAULT FALSE,
        aprovisionado_en    TIMESTAMPTZ,

        -- ── Notas ─────────────────────────────────────────────
        notas_instalacion   TEXT,
        notas_tecnicas      TEXT,
        notas_admin         TEXT,

        -- ── Auditoría ─────────────────────────────────────────
        created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ,
        created_by          UUID           REFERENCES usuarios(id),
        updated_by          UUID           REFERENCES usuarios(id)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_contratos
        BEFORE UPDATE ON contratos
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_contratos_empresa
        ON contratos (empresa_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_contratos_cliente
        ON contratos (cliente_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_contratos_estado
        ON contratos (empresa_id, estado) WHERE deleted_at IS NULL;

      CREATE INDEX idx_contratos_plan
        ON contratos (plan_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_contratos_router
        ON contratos (router_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_contratos_ip
        ON contratos (ip_asignada) WHERE ip_asignada IS NOT NULL;

      CREATE INDEX idx_contratos_pppoe
        ON contratos (usuario_pppoe) WHERE usuario_pppoe IS NOT NULL;

      -- Para el job de cortes automáticos: buscar morosos
      CREATE INDEX idx_contratos_mora
        ON contratos (empresa_id, estado, deuda_total)
        WHERE estado IN ('activo', 'prorroga') AND deleted_at IS NULL;

      -- Para prórrogas vencidas
      CREATE INDEX idx_contratos_prorroga
        ON contratos (empresa_id, prorroga_hasta)
        WHERE en_prorroga = TRUE AND deleted_at IS NULL;

      -- número de contrato único entre activos; soft-deleted no bloquean reuso
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_empresa_numero
        ON contratos (empresa_id, numero_contrato)
        WHERE deleted_at IS NULL;
      -- una ONU solo puede estar en un contrato activo a la vez
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_empresa_onu
        ON contratos (empresa_id, onu_id)
        WHERE deleted_at IS NULL AND onu_id IS NOT NULL;

      COMMENT ON TABLE contratos IS 'Contratos de servicio: nexo entre cliente, plan, router, ONU e IP';
      COMMENT ON COLUMN contratos.precio_final IS 'Precio calculado automáticamente con descuento aplicado';
      COMMENT ON COLUMN contratos.meses_deuda IS 'Meses consecutivos sin pagar, para priorizar gestión de cobranza';
    `);

    // ── Agregar FK de ips_asignadas → contratos ───────────────
    await queryRunner.query(`
      ALTER TABLE ips_asignadas
        ADD COLUMN contrato_id UUID REFERENCES contratos(id) ON DELETE SET NULL;

      CREATE INDEX idx_ips_contrato
        ON ips_asignadas (contrato_id) WHERE contrato_id IS NOT NULL;
    `);

    // ── Historial de estados del contrato ─────────────────────
    await queryRunner.query(`
      CREATE TABLE contratos_historial (
        id                BIGSERIAL      PRIMARY KEY,
        contrato_id       UUID           NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
        empresa_id        UUID           NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estado_anterior   estado_contrato,
        estado_nuevo      estado_contrato NOT NULL,
        motivo            TEXT,
        usuario_id        UUID           REFERENCES usuarios(id) ON DELETE SET NULL,
        automatico        BOOLEAN        NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cont_hist_contrato
        ON contratos_historial (contrato_id, created_at DESC);

      COMMENT ON TABLE contratos_historial
        IS 'Historial de cambios de estado de contratos (cortes, reactivaciones, prórrogas)';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contratos_historial CASCADE`);
    await queryRunner.query(`ALTER TABLE ips_asignadas DROP COLUMN IF EXISTS contrato_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS contratos CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_contrato CASCADE`);
  }
}
