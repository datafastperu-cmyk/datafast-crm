import { MigrationInterface, QueryRunner } from 'typeorm';

// La constraint UNIQUE (empresa_id, tipo_documento, numero_documento) en clientes
// es global (no filtra deleted_at IS NULL). Tras un rollback de onboarding que hace
// soft-delete del cliente, un segundo intento con el mismo documento falla con 23505.
// Se reemplaza por un índice único parcial que ignora registros soft-deleted.
export class FixClientesUniqueDocumentoConstraint1784900000000 implements MigrationInterface {
  name = 'FixClientesUniqueDocumentoConstraint1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clientes
        DROP CONSTRAINT IF EXISTS clientes_empresa_id_tipo_documento_numero_documento_key
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empresa_documento
        ON clientes (empresa_id, tipo_documento, numero_documento)
        WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_clientes_empresa_documento`);
    await queryRunner.query(`
      ALTER TABLE clientes
        ADD CONSTRAINT clientes_empresa_id_tipo_documento_numero_documento_key
        UNIQUE (empresa_id, tipo_documento, numero_documento)
    `);
  }
}
