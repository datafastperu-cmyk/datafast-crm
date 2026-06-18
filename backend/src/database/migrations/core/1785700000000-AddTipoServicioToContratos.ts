import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTipoServicioToContratos1785700000000 implements MigrationInterface {
  name = 'AddTipoServicioToContratos1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agregar columna con DEFAULT 'wisp' para no romper filas existentes
    await queryRunner.query(`
      ALTER TABLE contratos
        ADD COLUMN IF NOT EXISTS tipo_servicio tipo_servicio NOT NULL DEFAULT 'wisp'
    `);

    // Contratos que ya tienen ONU asignada son FTTH — corregir en caliente
    await queryRunner.query(`
      UPDATE contratos
        SET tipo_servicio = 'ftth'
      WHERE onu_id IS NOT NULL
        AND deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos DROP COLUMN IF EXISTS tipo_servicio
    `);
  }
}
