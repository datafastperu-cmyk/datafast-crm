import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 004 — Planes de servicio
// Planes contratados por los clientes: velocidad, precio,
// tipo de queue Mikrotik, perfil PPPoE, VLAN, etc.
// ─────────────────────────────────────────────────────────────
export class CreatePlanes1700000004000 implements MigrationInterface {
  name = 'CreatePlanes1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      CREATE TYPE tipo_queue AS ENUM (
        'simple_queue',
        'queue_tree',
        'pcq',
        'sin_limite'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE tipo_plan AS ENUM (
        'residencial',
        'empresarial',
        'dedicado',
        'prepago'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE planes (
        id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID         NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        -- Identificación
        nombre              VARCHAR(100) NOT NULL,
        descripcion         TEXT,
        tipo                tipo_plan    NOT NULL DEFAULT 'residencial',
        color_ui            VARCHAR(20)  DEFAULT '#3B82F6',  -- para el panel

        -- ── Velocidad ─────────────────────────────────────────
        velocidad_bajada    INTEGER      NOT NULL CHECK (velocidad_bajada > 0),  -- Mbps
        velocidad_subida    INTEGER      NOT NULL CHECK (velocidad_subida > 0),  -- Mbps
        -- Velocidad burst (ráfaga temporal)
        burst_bajada        INTEGER,     -- Mbps (0 = sin burst)
        burst_subida        INTEGER,
        burst_tiempo        SMALLINT     DEFAULT 0,  -- segundos de burst permitido
        -- Velocidad garantizada (para plans empresariales)
        velocidad_garantizada INTEGER,   -- % de la velocidad contratada garantizada

        -- ── Precio ────────────────────────────────────────────
        precio              DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
        precio_instalacion  DECIMAL(10,2) DEFAULT 0,
        aplica_igv          BOOLEAN       NOT NULL DEFAULT TRUE,

        -- ── Mikrotik / PPPoE ──────────────────────────────────
        tipo_queue          tipo_queue    NOT NULL DEFAULT 'simple_queue',
        ppp_profile         VARCHAR(100),  -- nombre del perfil PPP en RouterOS
        ppp_service         VARCHAR(50)   DEFAULT 'pppoe',  -- pppoe | pptp | l2tp
        pool_ip             VARCHAR(100),  -- nombre del pool de IPs en RouterOS

        -- ── Red ───────────────────────────────────────────────
        vlan_id             SMALLINT      CHECK (vlan_id BETWEEN 1 AND 4094),
        tipo_servicio       tipo_servicio NOT NULL DEFAULT 'ftth',

        -- ── Facturación ───────────────────────────────────────
        ciclo_facturacion   VARCHAR(20)  DEFAULT 'mensual'
                              CHECK (ciclo_facturacion IN ('mensual', 'bimestral', 'trimestral', 'anual')),
        dias_contrato_minimo INTEGER     DEFAULT 0,  -- 0 = sin mínimo

        -- ── Límite de datos ───────────────────────────────────
        tiene_limite_datos  BOOLEAN      NOT NULL DEFAULT FALSE,
        limite_datos_gb     INTEGER,     -- NULL = ilimitado
        accion_al_limite    VARCHAR(20)  DEFAULT 'reducir_velocidad'
                              CHECK (accion_al_limite IN (
                                'reducir_velocidad', 'bloquear', 'notificar', 'sin_accion'
                              )),
        velocidad_post_limite INTEGER,   -- Mbps después del límite de datos

        -- ── Estado ────────────────────────────────────────────
        activo              BOOLEAN      NOT NULL DEFAULT TRUE,
        visible_en_portal   BOOLEAN      NOT NULL DEFAULT FALSE,  -- visible para el cliente
        orden_display       SMALLINT     DEFAULT 0,

        -- ── Auditoría ─────────────────────────────────────────
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_planes
        BEFORE UPDATE ON planes
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE UNIQUE INDEX IF NOT EXISTS uq_planes_empresa_nombre
        ON planes (empresa_id, nombre)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_planes_empresa
        ON planes (empresa_id) WHERE deleted_at IS NULL AND activo = TRUE;

      CREATE INDEX idx_planes_tipo_servicio
        ON planes (empresa_id, tipo_servicio) WHERE deleted_at IS NULL;

      COMMENT ON TABLE planes IS 'Planes de servicio internet ofrecidos a los clientes';
      COMMENT ON COLUMN planes.ppp_profile IS 'Debe coincidir exactamente con el nombre del perfil en RouterOS';
      COMMENT ON COLUMN planes.vlan_id IS 'VLAN 802.1Q asignada a este plan';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS planes CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_plan CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_queue CASCADE`);
  }
}
