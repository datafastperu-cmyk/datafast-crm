import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateXuiLinesTable1791700000000 implements MigrationInterface {
  name = 'CreateXuiLinesTable1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE xui_line_estado_sync AS ENUM (
          'pendiente_creacion', 'sincronizado', 'pendiente_eliminacion', 'error'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS xui_lines (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id           UUID NOT NULL,
        contrato_id          UUID NOT NULL,
        cliente_id           UUID NOT NULL,
        xui_line_id          VARCHAR(100),
        usuario              VARCHAR(60) NOT NULL,
        password             VARCHAR(500) NOT NULL,
        sufijo               SMALLINT NOT NULL DEFAULT 1,
        bouquet_ids          JSONB NOT NULL DEFAULT '[]',
        max_conexiones       SMALLINT NOT NULL DEFAULT 1,
        activo               BOOLEAN NOT NULL DEFAULT true,
        estado_sync          xui_line_estado_sync NOT NULL DEFAULT 'pendiente_creacion',
        intentos_sync        SMALLINT NOT NULL DEFAULT 0,
        ultimo_error_sync    TEXT,
        sincronizado_en      TIMESTAMPTZ,
        canal_actual         TEXT,
        conectado            BOOLEAN NOT NULL DEFAULT false,
        ultima_actividad_en  TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at           TIMESTAMPTZ,
        version              INTEGER NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_xui_lines_empresa_cliente
        ON xui_lines (empresa_id, cliente_id);
    `);

    // Un solo line activo por contrato — evita duplicados si el hook de
    // creación se dispara dos veces para el mismo contrato (reintentos).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_xui_lines_contrato_activo
        ON xui_lines (empresa_id, contrato_id)
        WHERE activo = true AND deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS xui_lines`);
    await queryRunner.query(`DROP TYPE IF EXISTS xui_line_estado_sync`);
  }
}
