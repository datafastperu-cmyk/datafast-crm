import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Fase 0 — Sistema de administración OLT de alto nivel
//
// 1. olt_dispositivos: +firmware, +zona_id
// 2. olt_health_snapshots: histórico POM + boards + ONUs (TSDB-like)
// 3. olt_alertas: motor de alertas con deduplicación
//
// Requiere: 1781700000000-CreateOltDispositivos,
//           1780800000000-CreateZonas
// ─────────────────────────────────────────────────────────────
export class AddOltHealthAlertasAndFirmware1789900000000 implements MigrationInterface {
  name = 'AddOltHealthAlertasAndFirmware1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── 1. Extender olt_dispositivos ─────────────────────────
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        ADD COLUMN IF NOT EXISTS firmware VARCHAR(100),
        ADD COLUMN IF NOT EXISTS zona_id  UUID REFERENCES zonas(id) ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_olt_disp_zona
        ON olt_dispositivos (zona_id)
        WHERE deleted_at IS NULL AND zona_id IS NOT NULL;

      COMMENT ON COLUMN olt_dispositivos.firmware
        IS 'Versión de firmware detectada automáticamente en test de conexión SSH';
      COMMENT ON COLUMN olt_dispositivos.zona_id
        IS 'Zona ERP vinculada para cross-reference con contratos y clientes';
    `);

    // ── 2. olt_health_snapshots ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE olt_health_snapshots (
        id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        olt_id        UUID         NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        empresa_id    UUID         NOT NULL,

        -- Identificador de la entidad muestreada
        -- slot NULL + port NULL → snapshot de board completo
        -- slot/port NOT NULL   → snapshot de puerto PON (POM)
        slot          SMALLINT,
        port          SMALLINT,

        -- POM — Pluggable Optical Module
        temp_celsius  NUMERIC(5,2),
        tx_dbm        NUMERIC(6,3),
        rx_dbm        NUMERIC(6,3),
        voltage_mv    NUMERIC(8,2),
        laser_ma      NUMERIC(7,3),
        pom_state     VARCHAR(20),

        -- Board / Slot
        board_type    VARCHAR(30),
        board_state   VARCHAR(20),
        onu_capacity  SMALLINT,

        -- Contadores de ONUs
        onus_online   SMALLINT,
        onus_offline  SMALLINT,
        onus_rogue    SMALLINT,
        onus_total    SMALLINT,

        -- Meta
        granularity   VARCHAR(10)  NOT NULL DEFAULT 'raw',
        captured_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        raw_json      JSONB
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_health_olt_ts
        ON olt_health_snapshots (olt_id, captured_at DESC);

      CREATE INDEX idx_health_slot_port
        ON olt_health_snapshots (olt_id, slot, port, captured_at DESC)
        WHERE slot IS NOT NULL AND port IS NOT NULL;

      CREATE INDEX idx_health_empresa_ts
        ON olt_health_snapshots (empresa_id, captured_at DESC);

      CREATE INDEX idx_health_granularity
        ON olt_health_snapshots (granularity, captured_at DESC);

      COMMENT ON TABLE olt_health_snapshots
        IS 'Histórico TSDB-like de salud OLT: POM por puerto, estado de boards y contadores de ONUs';
      COMMENT ON COLUMN olt_health_snapshots.granularity
        IS 'raw (7d) | hour (30d) | day (1año) — retención gestionada por cron';
    `);

    // ── 3. olt_alertas ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE olt_alertas (
        id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        olt_id         UUID         NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        empresa_id     UUID         NOT NULL,

        -- Clasificación
        severidad      VARCHAR(10)  NOT NULL
                                    CHECK (severidad IN ('critica','alta','media','baja')),
        tipo           VARCHAR(50)  NOT NULL,
        mensaje        TEXT         NOT NULL,

        -- Ciclo de vida
        estado         VARCHAR(20)  NOT NULL DEFAULT 'activa'
                                    CHECK (estado IN ('activa','resuelta','silenciada')),

        -- Entidad afectada (para deduplicación y contexto)
        entidad_tipo   VARCHAR(20),
        entidad_ref    VARCHAR(50),

        -- FK al contrato (ONU offline + contrato activo)
        contrato_id    UUID,

        -- Control de notificaciones y silenciado
        silenced_until TIMESTAMPTZ,
        notificado_at  TIMESTAMPTZ,

        -- Timestamps
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        resolved_at    TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      -- Índice de consulta principal: alertas activas por empresa
      CREATE INDEX idx_olt_alertas_empresa_activa
        ON olt_alertas (empresa_id, estado, severidad)
        WHERE estado = 'activa';

      -- Índice para consultas históricas por OLT
      CREATE INDEX idx_olt_alertas_olt_ts
        ON olt_alertas (olt_id, created_at DESC);

      -- Índice para cross-ref con contratos
      CREATE INDEX idx_olt_alertas_contrato
        ON olt_alertas (contrato_id)
        WHERE contrato_id IS NOT NULL;

      -- Índice UNIQUE parcial para deduplicación:
      -- No puede existir más de una alerta activa del mismo tipo
      -- para la misma entidad en la misma OLT.
      CREATE UNIQUE INDEX idx_olt_alertas_dedup
        ON olt_alertas (olt_id, tipo, COALESCE(entidad_ref, ''))
        WHERE estado = 'activa';

      -- Trigger para updated_at automático
      CREATE TRIGGER set_updated_at_olt_alertas
        BEFORE UPDATE ON olt_alertas
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      COMMENT ON TABLE olt_alertas
        IS 'Motor de alertas OLT: POM, boards, ONUs offline, pools agotados. Deduplicación via UNIQUE parcial.';
      COMMENT ON COLUMN olt_alertas.entidad_ref
        IS 'Referencia a la entidad: "0/1/2" para puerto PON, "slot:0" para board, etc.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS olt_alertas CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS olt_health_snapshots CASCADE`);
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        DROP COLUMN IF EXISTS zona_id,
        DROP COLUMN IF EXISTS firmware
    `);
  }
}
