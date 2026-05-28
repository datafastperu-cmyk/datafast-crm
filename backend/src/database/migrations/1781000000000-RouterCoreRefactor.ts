import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Migración — Router como núcleo de red
//   1. Añadir 'reverificando' al enum estado_equipo
//   2. Añadir uptime_str (VARCHAR 100) a routers
//   3. Normalizar total_sesiones_pppoe → NOT NULL DEFAULT 0
//   4. FK constraint segmentos_ipv4.router_id → routers(id)
//   5. Índice en segmentos_ipv4(router_id)
// ─────────────────────────────────────────────────────────────────────────────
export class RouterCoreRefactor1781000000000 implements MigrationInterface {
  name = 'RouterCoreRefactor1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // 1. Nuevo valor en el enum compartido estado_equipo
    await queryRunner.query(`
      ALTER TYPE estado_equipo ADD VALUE IF NOT EXISTS 'reverificando'
    `);

    // 2. Columna uptime legible (ej: "3d 14h 22m")
    await queryRunner.query(`
      ALTER TABLE routers
        ADD COLUMN IF NOT EXISTS uptime_str VARCHAR(100) NULL
    `);

    // 3. Normalizar total_sesiones_pppoe: backfill → NOT NULL → DEFAULT 0
    await queryRunner.query(`
      UPDATE routers SET total_sesiones_pppoe = 0 WHERE total_sesiones_pppoe IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE routers
        ALTER COLUMN total_sesiones_pppoe SET DEFAULT 0,
        ALTER COLUMN total_sesiones_pppoe SET NOT NULL
    `);

    // 4. FK constraint en segmentos_ipv4.router_id → routers(id)
    //    Usa ON DELETE SET NULL para no cascadear borrado de router a segmentos
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_segmentos_router'
            AND table_name = 'segmentos_ipv4'
        ) THEN
          ALTER TABLE segmentos_ipv4
            ADD CONSTRAINT fk_segmentos_router
            FOREIGN KEY (router_id)
            REFERENCES routers(id)
            ON DELETE SET NULL
            DEFERRABLE INITIALLY DEFERRED;
        END IF;
      END$$
    `);

    // 5. Índice parcial en segmentos_ipv4(router_id) para JOINs rápidos
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_segmentos_router_id
        ON segmentos_ipv4 (router_id)
        WHERE router_id IS NOT NULL AND deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_segmentos_router_id`);
    await queryRunner.query(`
      ALTER TABLE segmentos_ipv4 DROP CONSTRAINT IF EXISTS fk_segmentos_router
    `);
    await queryRunner.query(`
      ALTER TABLE routers
        ALTER COLUMN total_sesiones_pppoe DROP NOT NULL,
        ALTER COLUMN total_sesiones_pppoe DROP DEFAULT
    `);
    await queryRunner.query(`ALTER TABLE routers DROP COLUMN IF EXISTS uptime_str`);
    // Nota: PostgreSQL no soporta DROP VALUE en enums — reverificando queda en el tipo
  }
}
