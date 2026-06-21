import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDriftDetectado1788400000000 implements MigrationInterface {
  name = 'CreateDriftDetectado1788400000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS drift_detectado (
        id            BIGSERIAL    PRIMARY KEY,
        contrato_id   UUID         NOT NULL,
        router_id     UUID         NOT NULL,
        tipo_drift    TEXT         NOT NULL,   -- 'PPPOE_AUSENTE' | 'FIREWALL_AUSENTE'
        usuario_pppoe TEXT,
        ip_asignada   TEXT,
        estado        TEXT         NOT NULL DEFAULT 'DETECTADO',  -- 'DETECTADO' | 'ENCOLADO' | 'RESUELTO'
        resuelto_en   TIMESTAMPTZ,
        detectado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_drift_detectado_contrato
        ON drift_detectado (contrato_id, tipo_drift, detectado_en DESC)
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_drift_detectado_estado
        ON drift_detectado (estado, detectado_en DESC)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_drift_detectado_estado`);
    await qr.query(`DROP INDEX IF EXISTS idx_drift_detectado_contrato`);
    await qr.query(`DROP TABLE IF EXISTS drift_detectado`);
  }
}
