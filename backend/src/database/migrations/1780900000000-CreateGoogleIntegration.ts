import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGoogleIntegration1780900000000 implements MigrationInterface {
  name = 'CreateGoogleIntegration1780900000000';

  async up(qr: QueryRunner): Promise<void> {
    // ── Enums ──────────────────────────────────────────────
    await qr.query(`
      CREATE TYPE "google_sync_status_enum" AS ENUM (
        'connected', 'disconnected', 'error', 'refreshing'
      )
    `);

    await qr.query(`
      CREATE TYPE "google_sync_service_enum" AS ENUM (
        'contacts', 'calendar', 'drive', 'maps', 'oauth'
      )
    `);

    await qr.query(`
      CREATE TYPE "google_sync_result_enum" AS ENUM (
        'success', 'failed', 'partial', 'skipped'
      )
    `);

    // ── google_accounts ────────────────────────────────────
    await qr.query(`
      CREATE TABLE "google_accounts" (
        "id"                   UUID NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at"           TIMESTAMPTZ,

        "empresa_id"           VARCHAR NOT NULL,
        "google_email"         VARCHAR(200) NOT NULL DEFAULT '',
        "google_name"          VARCHAR(200),
        "google_picture"       VARCHAR(500),

        "tokens_encrypted"     TEXT NOT NULL DEFAULT '',
        "token_iv"             VARCHAR(64) NOT NULL DEFAULT '',
        "token_auth_tag"       VARCHAR(64) NOT NULL DEFAULT '',
        "scopes"               TEXT[] NOT NULL DEFAULT '{}',

        "status"               "google_sync_status_enum" NOT NULL DEFAULT 'connected',

        "calendar_enabled"     BOOLEAN NOT NULL DEFAULT TRUE,
        "contacts_enabled"     BOOLEAN NOT NULL DEFAULT TRUE,
        "drive_enabled"        BOOLEAN NOT NULL DEFAULT TRUE,
        "maps_enabled"         BOOLEAN NOT NULL DEFAULT TRUE,

        "last_sync_at"         TIMESTAMPTZ,
        "last_contacts_sync_at" TIMESTAMPTZ,
        "last_calendar_sync_at" TIMESTAMPTZ,
        "last_drive_sync_at"   TIMESTAMPTZ,

        "drive_root_folder_id" VARCHAR(100),
        "drive_storage_used"   BIGINT NOT NULL DEFAULT 0,
        "drive_storage_total"  BIGINT NOT NULL DEFAULT 0,

        "last_error"           TEXT,
        "error_count"          INTEGER NOT NULL DEFAULT 0,

        CONSTRAINT "pk_google_accounts" PRIMARY KEY ("id")
      )
    `);

    await qr.query(`
      CREATE UNIQUE INDEX "uq_google_accounts_empresa_id"
        ON "google_accounts" ("empresa_id")
        WHERE "deleted_at" IS NULL
    `);

    // ── google_sync_logs ───────────────────────────────────
    await qr.query(`
      CREATE TABLE "google_sync_logs" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at"        TIMESTAMPTZ,

        "empresa_id"        VARCHAR NOT NULL,
        "service"           "google_sync_service_enum" NOT NULL,
        "operation"         VARCHAR(100) NOT NULL,
        "result"            "google_sync_result_enum" NOT NULL,

        "records_processed" INTEGER NOT NULL DEFAULT 0,
        "records_failed"    INTEGER NOT NULL DEFAULT 0,

        "details"           TEXT,
        "error_message"     TEXT,
        "duration_ms"       INTEGER,
        "triggered_by"      VARCHAR(50),
        "reference_id"      VARCHAR,

        CONSTRAINT "pk_google_sync_logs" PRIMARY KEY ("id")
      )
    `);

    await qr.query(`
      CREATE INDEX "idx_google_sync_logs_empresa_created"
        ON "google_sync_logs" ("empresa_id", "created_at")
    `);

    await qr.query(`
      CREATE INDEX "idx_google_sync_logs_empresa_service"
        ON "google_sync_logs" ("empresa_id", "service")
    `);

    // ── google_client_contacts (mapeo cliente → contacto Google) ──
    await qr.query(`
      CREATE TABLE "google_client_contacts" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        "empresa_id"        VARCHAR NOT NULL,
        "cliente_id"        VARCHAR NOT NULL,
        "google_contact_id" VARCHAR(200) NOT NULL,
        "synced_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT "pk_google_client_contacts" PRIMARY KEY ("id")
      )
    `);

    await qr.query(`
      CREATE UNIQUE INDEX "uq_google_client_contacts_cliente"
        ON "google_client_contacts" ("cliente_id")
    `);

    await qr.query(`
      CREATE INDEX "idx_google_client_contacts_empresa"
        ON "google_client_contacts" ("empresa_id")
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS "google_client_contacts"`);
    await qr.query(`DROP TABLE IF EXISTS "google_sync_logs"`);
    await qr.query(`DROP TABLE IF EXISTS "google_accounts"`);
    await qr.query(`DROP TYPE IF EXISTS "google_sync_result_enum"`);
    await qr.query(`DROP TYPE IF EXISTS "google_sync_service_enum"`);
    await qr.query(`DROP TYPE IF EXISTS "google_sync_status_enum"`);
  }
}
