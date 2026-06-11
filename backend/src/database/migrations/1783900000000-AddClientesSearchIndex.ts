import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientesSearchIndex1783900000000 implements MigrationInterface {
  name = 'AddClientesSearchIndex1783900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Habilitar extensión pg_trgm para búsqueda fuzzy con índice GIN
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Índice GIN sobre campos de búsqueda frecuente.
    // Acelera los ILIKE '%term%' del filtro full-text de clientes.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_clientes_search_gin
      ON clientes
      USING gin (
        (
          COALESCE(nombre_completo, '') || ' ' ||
          COALESCE(numero_documento, '') || ' ' ||
          COALESCE(email, '') || ' ' ||
          COALESCE(telefono, '') || ' ' ||
          COALESCE(codigo_cliente, '') || ' ' ||
          COALESCE(direccion, '')
        ) gin_trgm_ops
      )
      WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_clientes_search_gin`);
  }
}
