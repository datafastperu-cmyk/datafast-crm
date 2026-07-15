import { MigrationInterface, QueryRunner } from 'typeorm';

// Registro persistente de errores de producción (Centro de Operaciones).
// Alimentada por AllExceptionsFilter y por integraciones (OLT, MikroTik, etc.).
// `sincronizado` queda reservado para la futura sincronización con un
// servidor central de telemetría.
export class CreateEventosSistema1791800000000 implements MigrationInterface {
  name = 'CreateEventosSistema1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS eventos_sistema (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        nivel        VARCHAR(10)  NOT NULL DEFAULT 'error',
        origen       VARCHAR(40)  NOT NULL DEFAULT 'api',
        codigo       VARCHAR(60),
        mensaje      TEXT         NOT NULL,
        stack        TEXT,
        contexto     JSONB,
        sincronizado BOOLEAN      NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT chk_eventos_sistema_nivel CHECK (nivel IN ('critical', 'error', 'warn'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_eventos_sistema_created_at ON eventos_sistema (created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_eventos_sistema_origen_nivel ON eventos_sistema (origen, nivel)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS eventos_sistema`);
  }
}
