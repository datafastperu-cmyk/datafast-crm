import { MigrationInterface, QueryRunner } from 'typeorm';

// Agrega sector_id opcional a egresos_ingresos para poder calcular
// el flujo neto por zona en proyectos de inversión.
export class AddSectorIdToEgresosIngresos1781900000000 implements MigrationInterface {
  name = 'AddSectorIdToEgresosIngresos1781900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE egresos_ingresos
        ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES zonas(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_egresos_ingresos_sector
        ON egresos_ingresos (empresa_id, sector_id)
        WHERE sector_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_egresos_ingresos_sector`);
    await queryRunner.query(`ALTER TABLE egresos_ingresos DROP COLUMN IF EXISTS sector_id`);
  }
}
