import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProyectoInversionIdToEgresosIngresos1782100000000 implements MigrationInterface {
  name = 'AddProyectoInversionIdToEgresosIngresos1782100000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE egresos_ingresos
        ADD COLUMN IF NOT EXISTS proyecto_inversion_id UUID NULL
          REFERENCES proyectos_inversion(id) ON DELETE SET NULL;
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_egresos_ingresos_proyecto_inversion_id
        ON egresos_ingresos (proyecto_inversion_id)
        WHERE proyecto_inversion_id IS NOT NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_egresos_ingresos_proyecto_inversion_id;`);
    await qr.query(`ALTER TABLE egresos_ingresos DROP COLUMN IF EXISTS proyecto_inversion_id;`);
  }
}
