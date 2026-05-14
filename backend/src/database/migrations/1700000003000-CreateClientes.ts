import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 003 — Clientes
// Tabla principal de clientes del ISP con soporte para
// RENIEC, coordenadas GPS, historial y metadatos completos.
// ─────────────────────────────────────────────────────────────
export class CreateClientes1700000003000 implements MigrationInterface {
  name = 'CreateClientes1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      CREATE TYPE estado_cliente AS ENUM (
        'activo',
        'suspendido',
        'moroso',
        'baja_temporal',
        'baja_definitiva',
        'prospecto'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE clientes (
        id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        -- ── Datos de identidad (RENIEC) ──────────────────────
        tipo_documento  tipo_documento NOT NULL DEFAULT 'dni',
        numero_documento VARCHAR(20)  NOT NULL,
        nombres         VARCHAR(100)  NOT NULL,
        apellido_paterno VARCHAR(80)  NOT NULL,
        apellido_materno VARCHAR(80),
        nombre_completo VARCHAR(300)  GENERATED ALWAYS AS (
                          nombres || ' ' || apellido_paterno ||
                          CASE WHEN apellido_materno IS NOT NULL
                               THEN ' ' || apellido_materno
                               ELSE '' END
                        ) STORED,

        -- ── Contacto ─────────────────────────────────────────
        email           VARCHAR(150),
        telefono        VARCHAR(20)   NOT NULL,
        telefono_alt    VARCHAR(20),
        whatsapp        VARCHAR(20),

        -- ── Dirección ────────────────────────────────────────
        direccion       TEXT          NOT NULL,
        referencia      TEXT,
        departamento    VARCHAR(100),
        provincia       VARCHAR(100),
        distrito        VARCHAR(100),
        ubigeo          VARCHAR(10),
        codigo_postal   VARCHAR(10),

        -- ── Coordenadas GPS (para mapa de clientes) ──────────
        latitud         DECIMAL(10, 7),
        longitud        DECIMAL(10, 7),
        precision_gps   DECIMAL(8, 2),  -- metros de precisión

        -- ── Multimedia ────────────────────────────────────────
        foto_url        VARCHAR(500),
        foto_instalacion_url VARCHAR(500),

        -- ── Estado ────────────────────────────────────────────
        estado          estado_cliente NOT NULL DEFAULT 'prospecto',
        fecha_estado    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        motivo_estado   TEXT,

        -- ── Datos adicionales ISP ─────────────────────────────
        tipo_servicio   tipo_servicio  DEFAULT 'ftth',
        codigo_cliente  VARCHAR(30),   -- código interno del ISP
        notas_internas  TEXT,
        etiquetas       TEXT[],        -- ['empresa', 'prioridad', ...]

        -- ── Facturación especial ─────────────────────────────
        es_empresa      BOOLEAN        NOT NULL DEFAULT FALSE,
        ruc_empresa     VARCHAR(20),
        razon_social    VARCHAR(200),

        -- ── Referido ─────────────────────────────────────────
        referido_por    UUID           REFERENCES clientes(id) ON DELETE SET NULL,

        -- ── Captado por ──────────────────────────────────────
        vendedor_id     UUID           REFERENCES usuarios(id) ON DELETE SET NULL,

        -- ── RENIEC metadata ───────────────────────────────────
        reniec_consultado   BOOLEAN    NOT NULL DEFAULT FALSE,
        reniec_consultado_en TIMESTAMPTZ,
        reniec_datos_raw    JSONB,     -- respuesta completa de RENIEC

        -- ── Auditoría ─────────────────────────────────────────
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ,
        created_by      UUID          REFERENCES usuarios(id) ON DELETE SET NULL,
        updated_by      UUID          REFERENCES usuarios(id) ON DELETE SET NULL,

        UNIQUE (empresa_id, tipo_documento, numero_documento)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_clientes
        BEFORE UPDATE ON clientes
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
    `);

    // ── Índices de búsqueda frecuente ─────────────────────────
    await queryRunner.query(`
      CREATE INDEX idx_clientes_empresa
        ON clientes (empresa_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_clientes_documento
        ON clientes (tipo_documento, numero_documento) WHERE deleted_at IS NULL;

      CREATE INDEX idx_clientes_estado
        ON clientes (empresa_id, estado) WHERE deleted_at IS NULL;

      CREATE INDEX idx_clientes_vendedor
        ON clientes (vendedor_id) WHERE deleted_at IS NULL;

      -- Índice geoespacial para mapa de clientes
      CREATE INDEX idx_clientes_gps
        ON clientes (latitud, longitud)
        WHERE latitud IS NOT NULL AND longitud IS NOT NULL AND deleted_at IS NULL;

      -- Búsqueda de texto completo (nombre, email, teléfono, dirección)
      CREATE INDEX idx_clientes_nombre_trgm
        ON clientes USING GIN (nombre_completo gin_trgm_ops);

      CREATE INDEX idx_clientes_email_trgm
        ON clientes USING GIN (email gin_trgm_ops) WHERE email IS NOT NULL;

      CREATE INDEX idx_clientes_telefono
        ON clientes (telefono);

      CREATE INDEX idx_clientes_codigo
        ON clientes (empresa_id, codigo_cliente)
        WHERE codigo_cliente IS NOT NULL;

      COMMENT ON TABLE clientes IS 'Clientes del ISP con datos completos de RENIEC, GPS e historial';
      COMMENT ON COLUMN clientes.nombre_completo IS 'Columna generada automáticamente: nombres + apellidos';
      COMMENT ON COLUMN clientes.etiquetas IS 'Array de tags para clasificación flexible';
      COMMENT ON COLUMN clientes.reniec_datos_raw IS 'JSON completo de la respuesta de RENIEC para auditoría';
    `);

    // ── Historial de estados del cliente ─────────────────────
    await queryRunner.query(`
      CREATE TABLE clientes_historial_estados (
        id              BIGSERIAL     PRIMARY KEY,
        cliente_id      UUID          NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        empresa_id      UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estado_anterior estado_cliente,
        estado_nuevo    estado_cliente NOT NULL,
        motivo          TEXT,
        usuario_id      UUID          REFERENCES usuarios(id) ON DELETE SET NULL,
        automatico      BOOLEAN       NOT NULL DEFAULT FALSE,  -- cambio por sistema vs manual
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cli_hist_cliente
        ON clientes_historial_estados (cliente_id, created_at DESC);

      COMMENT ON TABLE clientes_historial_estados
        IS 'Historial de todos los cambios de estado de un cliente';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS clientes_historial_estados CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS clientes CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_cliente CASCADE`);
  }
}
