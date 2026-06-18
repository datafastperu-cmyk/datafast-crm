import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 001 — Extensiones, ENUMS y tabla EMPRESAS
// Base de toda la arquitectura multiempresa del sistema.
// ─────────────────────────────────────────────────────────────
export class CreateExtensionsAndEmpresas1700000001000
  implements MigrationInterface
{
  name = 'CreateExtensionsAndEmpresas1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── Extensiones PostgreSQL necesarias ─────────────────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);   // búsqueda fuzzy
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`);  // búsqueda sin tildes
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "btree_gin"`); // índices GIN en btree

    // ── Función para updated_at automático ────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION trigger_set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ── ENUMS globales del sistema ────────────────────────────

    await queryRunner.query(`
      CREATE TYPE estado_general AS ENUM (
        'activo', 'inactivo', 'suspendido', 'eliminado'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE tipo_documento AS ENUM (
        'dni', 'ruc', 'ce', 'pasaporte'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE tipo_servicio AS ENUM (
        'ftth', 'wisp', 'dedicado', 'mixto'
      )
    `);

    // ── Tabla EMPRESAS (multitenancy) ─────────────────────────
    await queryRunner.query(`
      CREATE TABLE empresas (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

        -- Datos fiscales
        razon_social    VARCHAR(200)  NOT NULL,
        nombre_comercial VARCHAR(200),
        ruc             VARCHAR(20)   NOT NULL UNIQUE,
        direccion_fiscal TEXT,
        departamento    VARCHAR(100),
        provincia       VARCHAR(100),
        distrito        VARCHAR(100),
        ubigeo          VARCHAR(10),

        -- Contacto
        telefono        VARCHAR(20),
        email           VARCHAR(150),
        sitio_web       VARCHAR(250),
        logo_url        VARCHAR(500),

        -- Configuración
        moneda          VARCHAR(10)   NOT NULL DEFAULT 'PEN',
        simbolo_moneda  VARCHAR(5)    NOT NULL DEFAULT 'S/',
        igv_rate        DECIMAL(5,4)  NOT NULL DEFAULT 0.1800,
        dia_facturacion SMALLINT      NOT NULL DEFAULT 1
                          CHECK (dia_facturacion BETWEEN 1 AND 28),
        dias_gracia     SMALLINT      NOT NULL DEFAULT 5
                          CHECK (dias_gracia BETWEEN 0 AND 30),
        zona_horaria    VARCHAR(50)   NOT NULL DEFAULT 'America/Lima',

        -- SUNAT / Facturación electrónica
        sunat_usuario   VARCHAR(100),
        sunat_clave     VARCHAR(500),  -- cifrado AES-256
        sunat_ambiente  VARCHAR(20)    DEFAULT 'beta'
                          CHECK (sunat_ambiente IN ('beta', 'produccion')),
        serie_boleta    VARCHAR(10)   DEFAULT 'B001',
        serie_factura   VARCHAR(10)   DEFAULT 'F001',
        correlativo_boleta   INTEGER  DEFAULT 1,
        correlativo_factura  INTEGER  DEFAULT 1,

        -- Notificaciones predeterminadas
        smtp_host       VARCHAR(200),
        smtp_port       SMALLINT      DEFAULT 587,
        smtp_usuario    VARCHAR(200),
        smtp_clave      VARCHAR(500),  -- cifrado AES-256
        smtp_from_name  VARCHAR(100),
        smtp_from_email VARCHAR(150),
        whatsapp_phone_id VARCHAR(100),
        whatsapp_token  TEXT,          -- cifrado AES-256

        -- Estado
        estado          estado_general NOT NULL DEFAULT 'activo',
        plan_sistema    VARCHAR(50)   DEFAULT 'basico'
                          CHECK (plan_sistema IN ('basico', 'profesional', 'enterprise')),
        max_clientes    INTEGER       DEFAULT 500,

        -- Auditoría
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_empresas
        BEFORE UPDATE ON empresas
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()
    `);

    await queryRunner.query(`
      CREATE INDEX idx_empresas_ruc     ON empresas (ruc);
      CREATE INDEX idx_empresas_estado  ON empresas (estado) WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      COMMENT ON TABLE empresas IS 'Empresas ISP registradas en el sistema (multitenancy)';
      COMMENT ON COLUMN empresas.igv_rate IS 'Tasa IGV vigente, por defecto 18% (0.1800)';
      COMMENT ON COLUMN empresas.dia_facturacion IS 'Día del mes en que se generan facturas automáticamente';
      COMMENT ON COLUMN empresas.dias_gracia IS 'Días de gracia antes del corte automático por mora';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS set_updated_at_empresas ON empresas`);
    await queryRunner.query(`DROP TABLE IF EXISTS empresas CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_general CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_documento CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_servicio CASCADE`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS trigger_set_updated_at CASCADE`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "btree_gin"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "unaccent"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "pg_trgm"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "uuid-ossp"`);
  }
}
