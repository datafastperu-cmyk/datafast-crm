import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOltBoardsProfilesSyncJobs1790100000000 implements MigrationInterface {
  name = 'CreateOltBoardsProfilesSyncJobs1790100000000';

  async up(qr: QueryRunner): Promise<void> {
    // ── olt_boards — tarjetas físicas detectadas por OLT ─────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_boards (
        id          UUID         NOT NULL DEFAULT gen_random_uuid(),
        empresa_id  UUID         NOT NULL,
        olt_id      UUID         NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        slot        SMALLINT     NOT NULL,
        board_type  VARCHAR(64)  NOT NULL,
        estado      VARCHAR(32)  NOT NULL DEFAULT 'unknown',
        onu_count   SMALLINT     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_olt_boards PRIMARY KEY (id),
        CONSTRAINT uq_olt_board_slot UNIQUE (olt_id, slot)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_boards_empresa ON olt_boards(empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_boards_olt     ON olt_boards(olt_id)`);

    // ── olt_line_profiles — perfiles de línea por OLT ───────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_line_profiles (
        id          UUID         NOT NULL DEFAULT gen_random_uuid(),
        empresa_id  UUID         NOT NULL,
        olt_id      UUID         NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        profile_id  INT          NOT NULL,
        nombre      VARCHAR(128) NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_olt_line_profiles PRIMARY KEY (id),
        CONSTRAINT uq_olt_line_profile UNIQUE (olt_id, profile_id)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_lp_empresa ON olt_line_profiles(empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_lp_olt     ON olt_line_profiles(olt_id)`);

    // ── olt_service_profiles — perfiles de servicio por OLT ─────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_service_profiles (
        id          UUID         NOT NULL DEFAULT gen_random_uuid(),
        empresa_id  UUID         NOT NULL,
        olt_id      UUID         NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        profile_id  INT          NOT NULL,
        nombre      VARCHAR(128) NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_olt_service_profiles PRIMARY KEY (id),
        CONSTRAINT uq_olt_service_profile UNIQUE (olt_id, profile_id)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_sp_empresa ON olt_service_profiles(empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_sp_olt     ON olt_service_profiles(olt_id)`);

    // ── olt_sync_jobs — jobs de sincronización OLT → ERP ────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_sync_jobs (
        id            UUID         NOT NULL DEFAULT gen_random_uuid(),
        empresa_id    UUID         NOT NULL,
        olt_id        UUID         NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        estado        VARCHAR(20)  NOT NULL DEFAULT 'pending',
        progreso      SMALLINT     NOT NULL DEFAULT 0,
        resultado     JSONB        NOT NULL DEFAULT '{}',
        error         TEXT,
        iniciado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        completado_en TIMESTAMPTZ,
        CONSTRAINT pk_olt_sync_jobs PRIMARY KEY (id),
        CONSTRAINT chk_sync_estado CHECK (
          estado IN ('pending','running','completed','failed')
        ),
        CONSTRAINT chk_sync_progreso CHECK (progreso BETWEEN 0 AND 100)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_sync_empresa ON olt_sync_jobs(empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_sync_olt     ON olt_sync_jobs(olt_id, iniciado_en DESC)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS olt_sync_jobs`);
    await qr.query(`DROP TABLE IF EXISTS olt_service_profiles`);
    await qr.query(`DROP TABLE IF EXISTS olt_line_profiles`);
    await qr.query(`DROP TABLE IF EXISTS olt_boards`);
  }
}
