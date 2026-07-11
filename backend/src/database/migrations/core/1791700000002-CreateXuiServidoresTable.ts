import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateXuiServidoresTable1791700000002 implements MigrationInterface {
  name = 'CreateXuiServidoresTable1791700000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE xui_servidor_estado_conexion AS ENUM ('ok', 'error', 'sin_probar');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS xui_servidores (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id                UUID NOT NULL,
        nombre                    VARCHAR(100) NOT NULL,
        descripcion               TEXT,
        api_url                   VARCHAR(300) NOT NULL,
        api_key                   TEXT NOT NULL,
        latitud                   DECIMAL(10,7),
        longitud                  DECIMAL(10,7),
        estado_conexion           xui_servidor_estado_conexion NOT NULL DEFAULT 'sin_probar',
        ultimo_error_conexion     TEXT,
        ultima_conexion_en        TIMESTAMPTZ,
        total_lineas              INT NOT NULL DEFAULT 0,
        total_bouquets            INT NOT NULL DEFAULT 0,
        total_canales             INT NOT NULL DEFAULT 0,
        catalogo_sincronizado_en  TIMESTAMPTZ,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at                TIMESTAMPTZ,
        version                   INTEGER NOT NULL DEFAULT 1
      );
    `);

    // Una sola fila por empresa — no hay concepto de multi-servidor.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_xui_servidores_empresa
        ON xui_servidores (empresa_id)
        WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS xui_servidores`);
    await queryRunner.query(`DROP TYPE IF EXISTS xui_servidor_estado_conexion`);
  }
}
