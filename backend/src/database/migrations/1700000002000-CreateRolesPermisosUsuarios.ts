import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 002 — Roles, Permisos y Usuarios internos
// RBAC granular: roles → permisos (many-to-many)
//                usuarios → roles (many-to-many)
// ─────────────────────────────────────────────────────────────
export class CreateRolesPermisosUsuarios1700000002000
  implements MigrationInterface
{
  name = 'CreateRolesPermisosUsuarios1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── PERMISOS ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE permisos (
        id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        codigo      VARCHAR(80) NOT NULL UNIQUE,  -- 'clientes:create'
        nombre      VARCHAR(150) NOT NULL,
        descripcion TEXT,
        modulo      VARCHAR(60) NOT NULL,  -- 'clientes', 'facturacion', etc.
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_permisos_modulo ON permisos (modulo);
      CREATE INDEX idx_permisos_codigo ON permisos (codigo);
      COMMENT ON TABLE permisos IS 'Permisos granulares del sistema RBAC';
      COMMENT ON COLUMN permisos.codigo IS 'Formato: modulo:accion, ej: clientes:create';
    `);

    // ── ROLES ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE roles (
        id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre      VARCHAR(80) NOT NULL,
        descripcion TEXT,
        es_sistema  BOOLEAN     NOT NULL DEFAULT FALSE,  -- roles predefinidos no editables
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ,

        UNIQUE (empresa_id, nombre)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_roles
        BEFORE UPDATE ON roles
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_roles_empresa ON roles (empresa_id) WHERE deleted_at IS NULL;
      COMMENT ON TABLE roles IS 'Roles de usuario por empresa';
      COMMENT ON COLUMN roles.es_sistema IS 'TRUE = rol predefinido del sistema, no se puede eliminar';
    `);

    // ── ROLES ↔ PERMISOS (many-to-many) ──────────────────────
    await queryRunner.query(`
      CREATE TABLE roles_permisos (
        rol_id      UUID NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
        permiso_id  UUID NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
        PRIMARY KEY (rol_id, permiso_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_roles_permisos_rol     ON roles_permisos (rol_id);
      CREATE INDEX idx_roles_permisos_permiso ON roles_permisos (permiso_id);
    `);

    // ── USUARIOS ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE estado_usuario AS ENUM (
        'activo', 'inactivo', 'bloqueado', 'pendiente_verificacion'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE usuarios (
        id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        -- Identidad
        nombres         VARCHAR(100) NOT NULL,
        apellidos       VARCHAR(100) NOT NULL,
        email           VARCHAR(150) NOT NULL,
        telefono        VARCHAR(20),
        foto_url        VARCHAR(500),

        -- Seguridad
        password_hash   VARCHAR(250) NOT NULL,
        estado          estado_usuario NOT NULL DEFAULT 'activo',
        email_verificado BOOLEAN     NOT NULL DEFAULT FALSE,
        token_verificacion VARCHAR(200),
        ultimo_acceso   TIMESTAMPTZ,
        intentos_fallidos SMALLINT   NOT NULL DEFAULT 0,
        bloqueado_hasta TIMESTAMPTZ,

        -- Refresh tokens (guardamos hash para invalidar)
        refresh_token_hash VARCHAR(500),

        -- Configuración personal
        zona_horaria    VARCHAR(50)  DEFAULT 'America/Lima',
        idioma          VARCHAR(10)  DEFAULT 'es',
        tema            VARCHAR(20)  DEFAULT 'dark'
                          CHECK (tema IN ('light', 'dark', 'auto')),

        -- Auditoría
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ,

        UNIQUE (empresa_id, email)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_usuarios
        BEFORE UPDATE ON usuarios
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_usuarios_empresa   ON usuarios (empresa_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_usuarios_email     ON usuarios (email)      WHERE deleted_at IS NULL;
      CREATE INDEX idx_usuarios_estado    ON usuarios (estado)     WHERE deleted_at IS NULL;

      COMMENT ON TABLE usuarios IS 'Usuarios internos del sistema (staff ISP)';
      COMMENT ON COLUMN usuarios.intentos_fallidos IS 'Se bloquea el usuario al llegar a 5 intentos';
      COMMENT ON COLUMN usuarios.refresh_token_hash IS 'Hash bcrypt del refresh token actual';
    `);

    // ── USUARIOS ↔ ROLES (many-to-many) ───────────────────────
    await queryRunner.query(`
      CREATE TABLE usuarios_roles (
        usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        rol_id      UUID NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
        asignado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        asignado_por UUID REFERENCES usuarios(id),
        PRIMARY KEY (usuario_id, rol_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_usuarios_roles_usuario ON usuarios_roles (usuario_id);
      CREATE INDEX idx_usuarios_roles_rol     ON usuarios_roles (rol_id);
    `);

    // ── LOG DE AUDITORÍA ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE auditoria_logs (
        id          BIGSERIAL   PRIMARY KEY,
        empresa_id  UUID        REFERENCES empresas(id) ON DELETE SET NULL,
        usuario_id  UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
        usuario_email VARCHAR(150),

        -- Acción
        accion      VARCHAR(80) NOT NULL,  -- 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', etc.
        modulo      VARCHAR(60) NOT NULL,
        entidad_id  VARCHAR(100),          -- ID del registro afectado
        descripcion TEXT,

        -- Contexto HTTP
        ip_address  INET,
        user_agent  TEXT,
        metodo_http VARCHAR(10),
        ruta        VARCHAR(500),

        -- Datos
        datos_anteriores JSONB,
        datos_nuevos     JSONB,

        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_audit_empresa    ON auditoria_logs (empresa_id);
      CREATE INDEX idx_audit_usuario    ON auditoria_logs (usuario_id);
      CREATE INDEX idx_audit_accion     ON auditoria_logs (accion);
      CREATE INDEX idx_audit_modulo     ON auditoria_logs (modulo);
      CREATE INDEX idx_audit_created    ON auditoria_logs (created_at DESC);
      CREATE INDEX idx_audit_entidad    ON auditoria_logs (entidad_id) WHERE entidad_id IS NOT NULL;

      COMMENT ON TABLE auditoria_logs IS 'Log de auditoría de todas las acciones del sistema';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS auditoria_logs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS usuarios_roles CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS usuarios CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_usuario CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS roles_permisos CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS roles CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS permisos CASCADE`);
  }
}
