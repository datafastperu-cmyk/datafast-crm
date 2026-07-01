import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetricasOnuOptical1790200000000 implements MigrationInterface {
  name = 'CreateMetricasOnuOptical1790200000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS metricas_onu_optical (
        id                  BIGSERIAL    NOT NULL,
        onu_id              UUID         NOT NULL,
        olt_dispositivo_id  UUID         NOT NULL,
        empresa_id          UUID         NOT NULL,
        rx_power_dbm        DECIMAL(6,2),
        tx_power_dbm        DECIMAL(6,2),
        temperatura_c       DECIMAL(5,1),
        timestamp           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_metricas_onu_optical PRIMARY KEY (id)
      )
    `);

    await qr.query(`CREATE INDEX IF NOT EXISTS idx_mou_onu_ts     ON metricas_onu_optical (onu_id,           timestamp)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_mou_empresa_ts ON metricas_onu_optical (empresa_id,       timestamp)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_mou_olt_ts     ON metricas_onu_optical (olt_dispositivo_id, timestamp)`);
    // Índice de alto rendimiento para el LATERAL JOIN por OLT + último timestamp
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_metricas_onu_olt_ts ON metricas_onu_optical (olt_dispositivo_id, timestamp DESC)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS metricas_onu_optical`);
  }
}
