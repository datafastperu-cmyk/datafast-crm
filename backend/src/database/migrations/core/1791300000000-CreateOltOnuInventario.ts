import { MigrationInterface, QueryRunner } from 'typeorm';

// Read-model del estado observado de ONUs en la OLT (snapshot del reconcile job).
export class CreateOltOnuInventario1791300000000 implements MigrationInterface {
  name = 'CreateOltOnuInventario1791300000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_onu_inventario (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id        UUID NOT NULL,
        olt_id            UUID NOT NULL,
        slot              INT  NOT NULL,
        port              INT  NOT NULL,
        onu_id            INT,
        sn                VARCHAR(32) NOT NULL,
        estado_operativo  VARCHAR(24) NOT NULL,
        control_flag      VARCHAR(16),
        run_state         VARCHAR(16),
        rx_power_dbm      DOUBLE PRECISION,
        sin_contrato      BOOLEAN NOT NULL DEFAULT TRUE,
        contrato_id       UUID,
        numero_contrato   VARCHAR(40),
        cliente           VARCHAR(200),
        origen            VARCHAR(12) NOT NULL DEFAULT 'configurada',
        snapshot_at       TIMESTAMPTZ NOT NULL,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_onu_inv_empresa ON olt_onu_inventario (empresa_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_olt_onu_inv_olt ON olt_onu_inventario (olt_id)`);
    await qr.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_olt_onu_inv ON olt_onu_inventario (olt_id, slot, port, sn)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS olt_onu_inventario`);
  }
}
