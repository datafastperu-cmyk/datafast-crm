import { MigrationInterface, QueryRunner } from 'typeorm';

// olt_dispositivos.router_id → nullable
// Las OLTs registradas via wizard nativo SSH no necesitan un router MikroTik
// asociado en el ERP. La FK al router es opcional: solo aplica cuando la OLT
// está detrás de un router MikroTik gestionado por el sistema.
export class MakeOltRouterIdNullable1790000000000 implements MigrationInterface {
  name = 'MakeOltRouterIdNullable1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        ALTER COLUMN router_id DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Requiere que todas las filas tengan router_id antes de restaurar NOT NULL
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        ALTER COLUMN router_id SET NOT NULL
    `);
  }
}
