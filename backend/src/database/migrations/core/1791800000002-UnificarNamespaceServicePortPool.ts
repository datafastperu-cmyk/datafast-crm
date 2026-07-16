import { MigrationInterface, QueryRunner } from 'typeorm';

// Opción A — namespace único de service-ports (directriz "inyectar desde cero"):
// un ID físico = un dueño. Antes el pool era unique por (olt_id, canal, service_port_id),
// lo que permitía que el MISMO service_port_id existiera en 'datos' y 'gestion' a la vez
// (solape real: 3000 libre en datos y ocupado en gestion) → riesgo de doble asignación
// contra la OLT. Ahora `canal` deja de particionar el espacio y pasa a ser el ROL de la
// asignación; la unicidad es (olt_id, service_port_id): imposible doble-asignar por
// construcción. Migración: dedupe (conservar el ocupado) + swap de constraint/índice.
export class UnificarNamespaceServicePortPool1791800000002 implements MigrationInterface {
  name = 'UnificarNamespaceServicePortPool1791800000002';

  public async up(qr: QueryRunner): Promise<void> {
    // 1. Dedupe: una fila por (olt_id, service_port_id). Se conserva el ocupado (una
    //    asignación real no se pierde), luego el no-borrado, luego el más antiguo.
    await qr.query(`
      DELETE FROM olt_service_port_pool
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY olt_id, service_port_id
            ORDER BY (estado = 'ocupado') DESC, (deleted_at IS NULL) DESC, created_at ASC
          ) AS rn
          FROM olt_service_port_pool
        ) t WHERE t.rn > 1
      )
    `);

    // 2. Swap de unicidad: por-canal → por-ID.
    await qr.query(`ALTER TABLE olt_service_port_pool DROP CONSTRAINT IF EXISTS uq_spp_olt_canal_service_port`);
    await qr.query(`
      ALTER TABLE olt_service_port_pool
        ADD CONSTRAINT uq_spp_olt_service_port UNIQUE (olt_id, service_port_id)
    `);

    // 3. Índice caliente de asignación atómica sobre el namespace único.
    await qr.query(`DROP INDEX IF EXISTS idx_spp_olt_canal_libre`);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_spp_olt_libre
        ON olt_service_port_pool(olt_id, service_port_id ASC)
        WHERE estado = 'libre' AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Reversible en estructura (el dedupe no se puede deshacer — datos redundantes).
    await qr.query(`DROP INDEX IF EXISTS idx_spp_olt_libre`);
    await qr.query(`ALTER TABLE olt_service_port_pool DROP CONSTRAINT IF EXISTS uq_spp_olt_service_port`);
    await qr.query(`
      ALTER TABLE olt_service_port_pool
        ADD CONSTRAINT uq_spp_olt_canal_service_port UNIQUE (olt_id, canal, service_port_id)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_spp_olt_canal_libre
        ON olt_service_port_pool(olt_id, canal, service_port_id ASC)
        WHERE estado = 'libre' AND deleted_at IS NULL
    `);
  }
}
