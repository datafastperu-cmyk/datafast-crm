import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUpdatedAtAndVariablesToNotificacionesLogs1788000000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    // Columna updated_at para detectar logs EN_PROCESO huérfanos
    await qr.query(`
      ALTER TABLE notificaciones_logs
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
    // Trigger que actualiza updated_at automáticamente en cada UPDATE
    await qr.query(`
      CREATE OR REPLACE FUNCTION fn_notif_logs_set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await qr.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'trg_notif_logs_updated_at'
        ) THEN
          CREATE TRIGGER trg_notif_logs_updated_at
          BEFORE UPDATE ON notificaciones_logs
          FOR EACH ROW EXECUTE FUNCTION fn_notif_logs_set_updated_at();
        END IF;
      END$$;
    `);

    // Columna variables JSONB para persistir vars del evento y reutilizarlas en reintentos
    await qr.query(`
      ALTER TABLE notificaciones_logs
        ADD COLUMN IF NOT EXISTS variables JSONB;
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_logs_updated_at
        ON notificaciones_logs (updated_at);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_notif_logs_updated_at`);
    await qr.query(`DROP TRIGGER IF EXISTS trg_notif_logs_updated_at ON notificaciones_logs`);
    await qr.query(`DROP FUNCTION IF EXISTS fn_notif_logs_set_updated_at`);
    await qr.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS variables`);
    await qr.query(`ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS updated_at`);
  }
}
