import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateComandosRedPendientes1786600000000 implements MigrationInterface {
  name = 'CreateComandosRedPendientes1786600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS comandos_red_pendientes (
        id            SERIAL        PRIMARY KEY,
        contrato_id   UUID          NOT NULL REFERENCES contratos(id)  ON DELETE CASCADE,
        router_id     UUID          NOT NULL REFERENCES routers(id)    ON DELETE CASCADE,
        accion        VARCHAR(50)   NOT NULL,
        payload       JSONB         NOT NULL DEFAULT '{}',
        intentos      INT           NOT NULL DEFAULT 0,
        max_intentos  INT           NOT NULL DEFAULT 12,
        estado        VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE',
        ultimo_error  TEXT,
        creado_en     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        ejecutado_en  TIMESTAMPTZ
      )
    `);

    /* Índice de búsqueda para el Cron — sólo registros pendientes */
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cmdr_pendiente
        ON comandos_red_pendientes (estado, intentos, creado_en)
        WHERE estado = 'PENDIENTE'
    `);

    /* Constraint de deduplicación: un solo comando PENDIENTE por (contrato, acción) */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdr_dedup_pendiente
        ON comandos_red_pendientes (contrato_id, accion)
        WHERE estado = 'PENDIENTE'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS comandos_red_pendientes`);
  }
}
