import { MigrationInterface, QueryRunner } from 'typeorm';

// Corrige constraints UNIQUE globales (sin filtro deleted_at IS NULL) que bloquean
// la re-creación de registros con los mismos datos tras un soft delete.
// Reemplaza cada constraint inline por un índice único parcial.
export class FixSoftDeleteUniqueConstraints1783000000000 implements MigrationInterface {
  name = 'FixSoftDeleteUniqueConstraints1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── segmentos_ipv4: UNIQUE (empresa_id, red_cidr) ──────────────────────────
    await queryRunner.query(`
      ALTER TABLE segmentos_ipv4
        DROP CONSTRAINT IF EXISTS segmentos_ipv4_empresa_id_red_cidr_key
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_segmentos_empresa_red_cidr
        ON segmentos_ipv4 (empresa_id, red_cidr)
        WHERE deleted_at IS NULL
    `);

    // ── planes: UNIQUE (empresa_id, nombre) ─────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE planes
        DROP CONSTRAINT IF EXISTS planes_empresa_id_nombre_key
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_planes_empresa_nombre
        ON planes (empresa_id, nombre)
        WHERE deleted_at IS NULL
    `);

    // ── routers: UNIQUE (empresa_id, ip_gestion) ────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE routers
        DROP CONSTRAINT IF EXISTS routers_empresa_id_ip_gestion_key
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_routers_empresa_ip_gestion
        ON routers (empresa_id, ip_gestion)
        WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_routers_empresa_ip_gestion`);
    await queryRunner.query(`ALTER TABLE routers ADD CONSTRAINT routers_empresa_id_ip_gestion_key UNIQUE (empresa_id, ip_gestion)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_planes_empresa_nombre`);
    await queryRunner.query(`ALTER TABLE planes ADD CONSTRAINT planes_empresa_id_nombre_key UNIQUE (empresa_id, nombre)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_segmentos_empresa_red_cidr`);
    await queryRunner.query(`ALTER TABLE segmentos_ipv4 ADD CONSTRAINT segmentos_ipv4_empresa_id_red_cidr_key UNIQUE (empresa_id, red_cidr)`);
  }
}
