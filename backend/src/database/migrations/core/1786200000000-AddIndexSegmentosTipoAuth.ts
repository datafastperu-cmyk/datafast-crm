import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexSegmentosTipoAuth1786200000000 implements MigrationInterface {
  name = 'AddIndexSegmentosTipoAuth1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Índice compuesto para filtrado de pools en el wizard:
    // WHERE empresa_id = $1 AND tipo_servicio = $2 AND auth_type = $3
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_segmentos_empresa_tipo_auth
        ON segmentos_ipv4 (empresa_id, tipo_servicio, auth_type)
        WHERE deleted_at IS NULL AND activo = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_segmentos_empresa_tipo_auth
    `);
  }
}
