import { MigrationInterface, QueryRunner } from 'typeorm';

// Inc.4 (pool de gestión): el mismo pool sirve DOS canales por OLT —
//   'datos'   = service-port del plano de datos (GPON/PPPoE) — comportamiento actual
//   'gestion' = service-port del plano de gestión TR-069 (bootstrap DHCP Option 43)
// Cada canal tiene su propio rango; los IDs numéricos pueden solaparse entre canales,
// por eso la unicidad y el índice caliente incluyen `canal`.
export class AddCanalToServicePortPool1791700000006 implements MigrationInterface {
  name = 'AddCanalToServicePortPool1791700000006';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_service_port_pool
        ADD COLUMN IF NOT EXISTS canal VARCHAR(16) NOT NULL DEFAULT 'datos'
    `);

    // Unicidad por canal (las filas existentes quedaron en 'datos').
    await qr.query(`ALTER TABLE olt_service_port_pool DROP CONSTRAINT IF EXISTS uq_spp_olt_service_port`);
    await qr.query(`
      ALTER TABLE olt_service_port_pool
        ADD CONSTRAINT uq_spp_olt_canal_service_port UNIQUE (olt_id, canal, service_port_id)
    `);

    // Índice caliente de asignación atómica: ahora discrimina por canal.
    await qr.query(`DROP INDEX IF EXISTS idx_spp_olt_libre`);
    await qr.query(`
      CREATE INDEX idx_spp_olt_canal_libre
        ON olt_service_port_pool(olt_id, canal, service_port_id ASC)
        WHERE estado = 'libre' AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_spp_olt_canal_libre`);
    await qr.query(`ALTER TABLE olt_service_port_pool DROP CONSTRAINT IF EXISTS uq_spp_olt_canal_service_port`);
    await qr.query(`
      ALTER TABLE olt_service_port_pool
        ADD CONSTRAINT uq_spp_olt_service_port UNIQUE (olt_id, service_port_id)
    `);
    await qr.query(`
      CREATE INDEX idx_spp_olt_libre
        ON olt_service_port_pool(olt_id, service_port_id ASC)
        WHERE estado = 'libre' AND deleted_at IS NULL
    `);
    await qr.query(`ALTER TABLE olt_service_port_pool DROP COLUMN IF EXISTS canal`);
  }
}
