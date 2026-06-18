import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexContratosTipoServicio1786300000000 implements MigrationInterface {
  name = 'AddIndexContratosTipoServicio1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Para consultas del wizard de migración y reportes por tipo de servicio
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_contratos_empresa_tipo_servicio
        ON contratos (empresa_id, tipo_servicio)
        WHERE deleted_at IS NULL
    `);

    // Para encontrar rápidamente contratos FTTH de un cliente (recalc tipo_servicio)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_contratos_cliente_tipo_servicio
        ON contratos (cliente_id, tipo_servicio)
        WHERE deleted_at IS NULL AND estado != 'baja_definitiva'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contratos_empresa_tipo_servicio`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contratos_cliente_tipo_servicio`);
  }
}
