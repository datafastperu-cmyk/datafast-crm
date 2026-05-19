import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBackups1779700000001 implements MigrationInterface {
  name = 'CreateBackups1779700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE estado_backup AS ENUM ('en_progreso', 'completado', 'error'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE tipo_backup AS ENUM ('manual', 'auto'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE estado_subida AS ENUM ('pendiente', 'subido', 'error', 'deshabilitado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS backups (
        id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id    UUID         NOT NULL,
        tipo          tipo_backup  NOT NULL DEFAULT 'auto',
        estado        estado_backup NOT NULL DEFAULT 'en_progreso',
        archivo_local VARCHAR(500),
        tamano_bytes  BIGINT,
        contenido     TEXT[]       NOT NULL DEFAULT '{}',
        drive_file_id VARCHAR(200),
        drive_url     VARCHAR(500),
        drive_estado  estado_subida NOT NULL DEFAULT 'pendiente',
        correo_estado estado_subida NOT NULL DEFAULT 'pendiente',
        error_mensaje TEXT,
        logs          JSONB        NOT NULL DEFAULT '[]',
        completado_en TIMESTAMPTZ,
        creado_por    VARCHAR(200) NOT NULL DEFAULT 'sistema',
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_backups_empresa_fecha ON backups (empresa_id, created_at DESC)
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TRIGGER set_updated_at_backups
          BEFORE UPDATE ON backups
          FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS backup_config JSONB NOT NULL DEFAULT '{
          "habilitado": false,
          "horario": "02:00",
          "retencion": 10,
          "directorioLocal": "/opt/datafast/backups",
          "contenido": ["db", "config", "uploads"],
          "drive": {"habilitado": false, "credencialesJson": "", "carpetaId": ""},
          "correo": {"habilitado": false, "destinatarios": []}
        }'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS set_updated_at_backups ON backups`);
    await queryRunner.query(`DROP TABLE IF EXISTS backups CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_backup CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_backup CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_subida CASCADE`);
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS backup_config`);
  }
}
