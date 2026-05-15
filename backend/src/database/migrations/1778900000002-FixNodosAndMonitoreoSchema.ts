import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Migración fix — Ajusta nodos/nodos_mediciones al schema actual de la entidad
// y crea alertas + configuracion_alertas que no estaban en migraciones previas.
// ─────────────────────────────────────────────────────────────────────────────
export class FixNodosAndMonitoreoSchema1778900000002 implements MigrationInterface {
  name = 'FixNodosAndMonitoreoSchema1778900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── 1. Drop nodos_mediciones (depende de nodos; se recrea) ────────────────
    await queryRunner.query(`DROP TABLE IF EXISTS nodos_mediciones CASCADE`);

    // ── 2. Cambiar tipo_nodo enum al schema de la entidad ─────────────────────
    await queryRunner.query(`ALTER TABLE nodos ALTER COLUMN tipo TYPE TEXT`);
    await queryRunner.query(`ALTER TABLE nodos ALTER COLUMN tipo DROP DEFAULT`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_nodo CASCADE`);
    await queryRunner.query(`
      CREATE TYPE nodos_tipo_enum AS ENUM (
        'router', 'switch', 'olt', 'antena', 'servidor', 'cliente', 'enlace_uplink'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE nodos
      ALTER COLUMN tipo TYPE nodos_tipo_enum
      USING (CASE tipo
        WHEN 'olt'             THEN 'olt'
        WHEN 'switch'          THEN 'switch'
        WHEN 'onu'             THEN 'cliente'
        WHEN 'nodo_distribucion' THEN 'router'
        WHEN 'torre_principal' THEN 'router'
        WHEN 'caja_nap'        THEN 'switch'
        ELSE 'antena'
      END)::nodos_tipo_enum
    `);
    await queryRunner.query(
      `ALTER TABLE nodos ALTER COLUMN tipo SET DEFAULT 'router'::nodos_tipo_enum`,
    );

    // ── 3. FK olt_id ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE nodos
      ADD COLUMN IF NOT EXISTS olt_id UUID REFERENCES olts(id) ON DELETE SET NULL
    `);

    // ── 4. Renombrar ip_gestion → ip_monitoreo ────────────────────────────────
    await queryRunner.query(`ALTER TABLE nodos RENAME COLUMN ip_gestion TO ip_monitoreo`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_nodos_ip`);
    await queryRunner.query(`
      CREATE INDEX idx_nodos_ip ON nodos (ip_monitoreo) WHERE deleted_at IS NULL
    `);

    // ── 5. Columnas SNMP faltantes ────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE nodos
        ADD COLUMN IF NOT EXISTS snmp_habilitado    BOOLEAN  NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS snmp_puerto        SMALLINT NOT NULL DEFAULT 161,
        ADD COLUMN IF NOT EXISTS snmp_oid_cpu       VARCHAR(200),
        ADD COLUMN IF NOT EXISTS snmp_interface_index INT
    `);
    // Renombrar OID columns si aún tienen el nombre viejo
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'nodos' AND column_name = 'snmp_oid_rx'
        ) THEN
          ALTER TABLE nodos RENAME COLUMN snmp_oid_rx TO snmp_oid_trafico_rx;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'nodos' AND column_name = 'snmp_oid_tx'
        ) THEN
          ALTER TABLE nodos RENAME COLUMN snmp_oid_tx TO snmp_oid_trafico_tx;
        END IF;
      END $$
    `);

    // ── 6. Columnas ping faltantes ────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE nodos
        ADD COLUMN IF NOT EXISTS ping_habilitado    BOOLEAN  NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS ping_intervalo_seg SMALLINT NOT NULL DEFAULT 60,
        ADD COLUMN IF NOT EXISTS ping_timeout_ms    INT      NOT NULL DEFAULT 3000,
        ADD COLUMN IF NOT EXISTS ping_reintentos    SMALLINT NOT NULL DEFAULT 3
    `);

    // ── 7. Renombrar packet_loss_pct → perdida_pct ────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'nodos' AND column_name = 'packet_loss_pct'
        ) THEN
          ALTER TABLE nodos RENAME COLUMN packet_loss_pct TO perdida_pct;
        END IF;
      END $$
    `);

    // ── 8. Columnas de métricas / estado faltantes ────────────────────────────
    await queryRunner.query(`
      ALTER TABLE nodos
        ADD COLUMN IF NOT EXISTS estado_desde      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS uptime_pct_7d     DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS cpu_uso_pct       DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS memoria_uso_pct   DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS temperatura_c     DECIMAL(5,1),
        ADD COLUMN IF NOT EXISTS sesiones_pppoe    INT,
        ADD COLUMN IF NOT EXISTS alertas_habilitadas BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // ── 9. Recrear nodos_mediciones con schema de la entidad ──────────────────
    await queryRunner.query(`
      CREATE TABLE nodos_mediciones (
        id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        nodo_id         UUID        NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
        empresa_id      UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        latencia_ms     DECIMAL(8,2),
        perdida_pct     DECIMAL(5,2),
        online          BOOLEAN     NOT NULL DEFAULT TRUE,
        cpu_pct         DECIMAL(5,2),
        memoria_pct     DECIMAL(5,2),
        trafico_rx_bps  BIGINT,
        trafico_tx_bps  BIGINT,
        temperatura_c   DECIMAL(5,1),
        sesiones_pppoe  INT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_nodos_med_nodo_tiempo
        ON nodos_mediciones (nodo_id, "timestamp" DESC);
      CREATE INDEX idx_nodos_med_empresa_tiempo
        ON nodos_mediciones (empresa_id, "timestamp" DESC);
    `);

    // ── 10. Crear tipos enum para alertas ─────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alertas_nivel_enum') THEN
          CREATE TYPE alertas_nivel_enum AS ENUM ('info','warning','critical','recovery');
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alertas_estado_enum') THEN
          CREATE TYPE alertas_estado_enum AS ENUM ('activa','resuelta','ignorada');
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alertas_metrica_enum') THEN
          CREATE TYPE alertas_metrica_enum AS ENUM (
            'ping_latencia','ping_perdida','cpu','memoria',
            'trafico_bajada','trafico_subida','temperatura',
            'estado_nodo','sesiones_pppoe','senal_onu'
          );
        END IF;
      END $$
    `);

    // ── 11. Tabla alertas ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alertas (
        id                  UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID               NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nodo_id             UUID               REFERENCES nodos(id) ON DELETE SET NULL,
        nodo_nombre         VARCHAR(100),
        nivel               alertas_nivel_enum NOT NULL,
        estado              alertas_estado_enum NOT NULL DEFAULT 'activa',
        metrica             alertas_metrica_enum NOT NULL,
        mensaje             TEXT               NOT NULL,
        detalle             TEXT,
        valor_actual        DECIMAL(12,4),
        umbral              DECIMAL(12,4),
        resuelta_en         TIMESTAMPTZ,
        resuelta_por        UUID,
        duracion_minutos    INT,
        notificado_email    BOOLEAN            NOT NULL DEFAULT FALSE,
        notificado_whatsapp BOOLEAN            NOT NULL DEFAULT FALSE,
        created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alertas_empresa_estado_nivel
        ON alertas (empresa_id, estado, nivel) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_alertas_nodo_created
        ON alertas (nodo_id, created_at) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_alertas_empresa_created
        ON alertas (empresa_id, created_at) WHERE deleted_at IS NULL;
    `);

    // ── 12. Enum + tabla configuracion_alertas ────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'configuracion_alertas_metrica_enum') THEN
          CREATE TYPE configuracion_alertas_metrica_enum AS ENUM (
            'ping_latencia','ping_perdida','cpu','memoria',
            'trafico_bajada','trafico_subida','temperatura',
            'estado_nodo','sesiones_pppoe','senal_onu'
          );
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS configuracion_alertas (
        id                  UUID                              PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID                              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nodo_id             UUID                              REFERENCES nodos(id) ON DELETE CASCADE,
        metrica             configuracion_alertas_metrica_enum NOT NULL,
        umbral_warning      DECIMAL(10,2)                     NOT NULL,
        umbral_critical     DECIMAL(10,2)                     NOT NULL,
        duracion_minutos    SMALLINT                          NOT NULL DEFAULT 1,
        notificar_email     BOOLEAN                           NOT NULL DEFAULT FALSE,
        notificar_whatsapp  BOOLEAN                           NOT NULL DEFAULT FALSE,
        email_destino       VARCHAR(200),
        telefono_destino    VARCHAR(20),
        activo              BOOLEAN                           NOT NULL DEFAULT TRUE,
        descripcion         TEXT,
        created_at          TIMESTAMPTZ                       NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ                       NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_config_alertas_empresa
        ON configuracion_alertas (empresa_id, activo) WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS configuracion_alertas CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS configuracion_alertas_metrica_enum CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS alertas CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS alertas_metrica_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS alertas_estado_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS alertas_nivel_enum CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS nodos_mediciones CASCADE`);
  }
}
