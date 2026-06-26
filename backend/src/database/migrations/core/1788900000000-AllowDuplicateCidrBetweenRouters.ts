import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowDuplicateCidrBetweenRouters1788900000000 implements MigrationInterface {
  name = 'AllowDuplicateCidrBetweenRouters1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Permitir que dos routers distintos compartan el mismo CIDR.
    // La advertencia de conflicto se muestra en el frontend al momento de crear/editar.
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_segmentos_empresa_red_cidr
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_segmentos_empresa_red_cidr
        ON segmentos_ipv4 (empresa_id, red_cidr)
        WHERE deleted_at IS NULL
    `);
  }
}
