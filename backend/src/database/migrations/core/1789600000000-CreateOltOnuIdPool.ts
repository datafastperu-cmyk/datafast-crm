import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOltOnuIdPool1789600000000 implements MigrationInterface {
  name = 'CreateOltOnuIdPool1789600000000';

  public async up(qr: QueryRunner): Promise<void> {

    // ── 1. Tabla pool de ONU IDs por puerto PON ────────────────────
    await qr.query(`
      CREATE TABLE olt_onu_id_pool (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id      UUID        NOT NULL,
        olt_id          UUID        NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        slot            SMALLINT    NOT NULL,
        port            SMALLINT    NOT NULL,
        onu_id          SMALLINT    NOT NULL,
        estado          VARCHAR(20) NOT NULL DEFAULT 'libre',
        contrato_id     UUID,
        locked_at       TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ,
        version         INTEGER     NOT NULL DEFAULT 1,
        CONSTRAINT uq_onuid_pool_pos UNIQUE (olt_id, slot, port, onu_id)
      )
    `);

    // ── 2. Índice parcial para la asignación atómica ───────────────
    await qr.query(`
      CREATE INDEX idx_onuid_olt_libre
        ON olt_onu_id_pool(olt_id, slot, port, onu_id ASC)
        WHERE estado = 'libre' AND deleted_at IS NULL
    `);

    // ── 3. Índice por empresa para listados ─────────────────────────
    await qr.query(`
      CREATE INDEX idx_onuid_empresa
        ON olt_onu_id_pool(empresa_id)
        WHERE deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS olt_onu_id_pool`);
  }
}
