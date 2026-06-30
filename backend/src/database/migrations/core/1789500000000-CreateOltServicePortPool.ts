import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOltServicePortPool1789500000000 implements MigrationInterface {
  name = 'CreateOltServicePortPool1789500000000';

  public async up(qr: QueryRunner): Promise<void> {

    // ── 1. Tabla pool de Service Port IDs ─────────────────────────
    await qr.query(`
      CREATE TABLE olt_service_port_pool (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id      UUID        NOT NULL,
        olt_id          UUID        NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        service_port_id INTEGER     NOT NULL,
        estado          VARCHAR(20) NOT NULL DEFAULT 'libre',
        contrato_id     UUID,
        locked_at       TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ,
        version         INTEGER     NOT NULL DEFAULT 1,
        CONSTRAINT uq_spp_olt_service_port UNIQUE (olt_id, service_port_id)
      )
    `);

    // ── 2. Índice por empresa (para stats y listado) ───────────────
    await qr.query(`
      CREATE INDEX idx_spp_empresa
        ON olt_service_port_pool(empresa_id)
        WHERE deleted_at IS NULL
    `);

    // ── 3. Índice parcial para la asignación atómica (camino caliente) ──
    await qr.query(`
      CREATE INDEX idx_spp_olt_libre
        ON olt_service_port_pool(olt_id, service_port_id ASC)
        WHERE estado = 'libre' AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS olt_service_port_pool`);
  }
}
