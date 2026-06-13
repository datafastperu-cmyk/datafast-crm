import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMonitoreoTablesAndView1784400000000 implements MigrationInterface {
  name = 'CreateMonitoreoTablesAndView1784400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Enums de alertas ──────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nivel_alerta_enum') THEN
          CREATE TYPE nivel_alerta_enum AS ENUM ('CRITICA', 'WARNING');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_alerta_enum') THEN
          CREATE TYPE status_alerta_enum AS ENUM ('ACTIVA', 'RESUELTA');
        END IF;
      END $$
    `);

    // ── 2. Tabla metricas_monitoreo ──────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS metricas_monitoreo (
        id               BIGSERIAL    PRIMARY KEY,
        dispositivo_id   UUID         NOT NULL
                           REFERENCES dispositivos_monitoreo(id) ON DELETE CASCADE,
        ping_latencia_ms INTEGER,
        ping_loss_pct    SMALLINT,
        cpu_usage_pct    SMALLINT,
        memory_usage_pct SMALLINT,
        traffic_down_bps BIGINT,
        traffic_up_bps   BIGINT,
        timestamp        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_metricas_disp_ts
        ON metricas_monitoreo (dispositivo_id, timestamp DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_metricas_timestamp
        ON metricas_monitoreo (timestamp DESC)
    `);

    // ── 3. Tabla alertas_sistema ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alertas_sistema (
        id               UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id       VARCHAR           NOT NULL,
        dispositivo_id   UUID              NOT NULL
                           REFERENCES dispositivos_monitoreo(id) ON DELETE CASCADE,
        nivel            nivel_alerta_enum NOT NULL DEFAULT 'WARNING',
        categoria        VARCHAR(40),
        mensaje          TEXT              NOT NULL,
        valor_detectado  VARCHAR(50),
        valor_umbral     VARCHAR(50),
        status           status_alerta_enum NOT NULL DEFAULT 'ACTIVA',
        resuelto_at      TIMESTAMPTZ,
        resuelto_por_id  UUID,
        created_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alerta_disp_status
        ON alertas_sistema (dispositivo_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alerta_empresa
        ON alertas_sistema (empresa_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alerta_nivel
        ON alertas_sistema (nivel)
    `);

    // ── 4. Tabla umbrales_alerta ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS umbrales_alerta (
        id                        UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id                VARCHAR          NOT NULL,
        dispositivo_id            UUID
                                    REFERENCES dispositivos_monitoreo(id) ON DELETE CASCADE,
        tipo_equipo               tipo_equipo_enum,
        nombre                    VARCHAR(100),
        latencia_max_ms           INTEGER,
        loss_max_pct              SMALLINT,
        cpu_max_pct               SMALLINT,
        memory_max_pct            SMALLINT,
        traffic_down_max_bps      BIGINT,
        traffic_up_max_bps        BIGINT,
        nivel_alerta              VARCHAR(20)      NOT NULL DEFAULT 'WARNING',
        confirmaciones_requeridas SMALLINT         NOT NULL DEFAULT 3,
        created_at                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        deleted_at                TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_umbral_dispositivo
        ON umbrales_alerta (dispositivo_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_umbral_empresa
        ON umbrales_alerta (empresa_id)
    `);

    // ── 5. Vista v_estado_dispositivos ───────────────────────────────────────
    // LEFT JOIN lateral para obtener la última métrica por dispositivo (puede ser NULL
    // para dispositivos recién registrados sin métricas todavía).
    await queryRunner.query(`
      CREATE OR REPLACE VIEW v_estado_dispositivos AS
      SELECT
        d.id,
        d.empresa_id,
        d.nombre_emisor,
        d.ip_address,
        d.tipo_equipo,
        d.fabricante,
        d.status,
        d.last_seen_at,
        m.ping_latencia_ms,
        m.ping_loss_pct,
        m.cpu_usage_pct,
        m.memory_usage_pct,
        m.traffic_down_bps,
        m.traffic_up_bps,
        m.timestamp              AS ultima_metrica_at,
        COALESCE(a.alertas_activas, 0) AS alertas_activas
      FROM dispositivos_monitoreo d
      LEFT JOIN LATERAL (
        SELECT
          ping_latencia_ms,
          ping_loss_pct,
          cpu_usage_pct,
          memory_usage_pct,
          traffic_down_bps,
          traffic_up_bps,
          timestamp
        FROM metricas_monitoreo
        WHERE dispositivo_id = d.id
        ORDER BY timestamp DESC
        LIMIT 1
      ) m ON TRUE
      LEFT JOIN (
        SELECT dispositivo_id, COUNT(*) AS alertas_activas
        FROM alertas_sistema
        WHERE status = 'ACTIVA'
        GROUP BY dispositivo_id
      ) a ON a.dispositivo_id = d.id
      WHERE d.deleted_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS v_estado_dispositivos`);
    await queryRunner.query(`DROP TABLE IF EXISTS umbrales_alerta CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS alertas_sistema CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS metricas_monitoreo CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS status_alerta_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS nivel_alerta_enum`);
  }
}
