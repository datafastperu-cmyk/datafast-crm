import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración — Configuración Multi-Proveedor por OLT
//
// Crea la tabla olt_proveedor_config que permite asignar hasta
// N proveedores (nativo_ssh, nativo_snmp, smartolt, adminolt)
// a una misma OLT con prioridad, circuit breaker y health state.
//
// Requiere: 1781700000000-CreateOltDispositivos (tabla olt_dispositivos)
// ─────────────────────────────────────────────────────────────
export class CreateOltProveedorConfig1788500000000 implements MigrationInterface {
  name = 'CreateOltProveedorConfig1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── Tipos ENUM (idempotentes) ─────────────────────────────

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE proveedor_olt_tipo AS ENUM
          ('nativo_ssh', 'nativo_snmp', 'smartolt', 'adminolt');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE proveedor_circuit_estado AS ENUM
          ('closed', 'open', 'half_open');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE proveedor_health_estado AS ENUM
          ('ok', 'degraded', 'down', 'unknown');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla principal ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE olt_proveedor_config (
        id                      UUID                      PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id              UUID                      NOT NULL,

        -- FK a la OLT propietaria
        olt_id                  UUID                      NOT NULL
                                  REFERENCES olt_dispositivos(id) ON DELETE CASCADE,

        -- Tipo de proveedor: una fila por tipo por OLT
        tipo                    proveedor_olt_tipo        NOT NULL,

        -- Orden de intento: 1 = primario, 2 = fallback-1, 3 = fallback-2
        prioridad               SMALLINT                  NOT NULL DEFAULT 1
                                  CHECK (prioridad BETWEEN 1 AND 10),

        -- Credenciales en JSONB cifradas a nivel aplicación.
        -- Esquema por tipo:
        --   nativo_ssh/snmp : { ip, port, username, password_cifrado, brand }
        --   smartolt        : { base_url, api_key_cifrado, olt_id_externo }
        --   adminolt        : { base_url, username, password_cifrado, olt_id_externo }
        credenciales            JSONB                     NOT NULL DEFAULT '{}',

        activo                  BOOLEAN                   NOT NULL DEFAULT TRUE,

        -- Estado del circuit breaker para este proveedor en esta OLT
        circuit_estado          proveedor_circuit_estado  NOT NULL DEFAULT 'closed',
        circuit_fallas          SMALLINT                  NOT NULL DEFAULT 0,
        circuit_abierto_hasta   TIMESTAMPTZ               NULL,

        -- Último resultado del health monitor
        ultimo_health           TIMESTAMPTZ               NULL,
        health_estado           proveedor_health_estado   NOT NULL DEFAULT 'unknown',
        health_latencia_ms      INTEGER                   NULL,

        created_at              TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ               NOT NULL DEFAULT NOW(),

        -- Un tipo de proveedor por OLT como máximo
        UNIQUE (olt_id, tipo)
      )
    `);

    // ── Trigger updated_at ────────────────────────────────────
    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_olt_proveedor_config
        BEFORE UPDATE ON olt_proveedor_config
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()
    `);

    // ── Índices ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX idx_olt_prov_empresa
        ON olt_proveedor_config (empresa_id)
        WHERE activo = TRUE;

      CREATE INDEX idx_olt_prov_olt_prioridad
        ON olt_proveedor_config (olt_id, prioridad)
        WHERE activo = TRUE;

      CREATE INDEX idx_olt_prov_circuit_open
        ON olt_proveedor_config (circuit_abierto_hasta)
        WHERE circuit_estado = 'open';

      COMMENT ON TABLE olt_proveedor_config
        IS 'Configuración multi-proveedor por OLT: nativo SSH, SmartOLT, AdminOLT con circuit breaker independiente';
      COMMENT ON COLUMN olt_proveedor_config.credenciales
        IS 'JSONB con credenciales cifradas AES-256-GCM. Campos dependen del tipo de proveedor.';
      COMMENT ON COLUMN olt_proveedor_config.circuit_fallas
        IS 'Contador de fallos consecutivos. Se resetea a 0 en cada éxito.';
      COMMENT ON COLUMN olt_proveedor_config.circuit_abierto_hasta
        IS 'Timestamp hasta el cual el circuito permanece OPEN. NULL si closed/half_open.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS set_updated_at_olt_proveedor_config ON olt_proveedor_config`);
    await queryRunner.query(`DROP TABLE IF EXISTS olt_proveedor_config CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS proveedor_health_estado CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS proveedor_circuit_estado CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS proveedor_olt_tipo CASCADE`);
  }
}
