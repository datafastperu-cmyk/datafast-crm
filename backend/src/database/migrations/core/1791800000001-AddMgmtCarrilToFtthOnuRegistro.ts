import { MigrationInterface, QueryRunner } from 'typeorm';

// Persiste el estado del carril de gestión TR-069 (bootstrapTr069) en el registro FTTH,
// para restaurarlo automáticamente tras un re-aprovisionamiento (la OLT borra todos los
// service-ports de la ONU al re-registrarla, incluido el carril de gestión). Aditiva.
export class AddMgmtCarrilToFtthOnuRegistro1791800000001 implements MigrationInterface {
  name = 'AddMgmtCarrilToFtthOnuRegistro1791800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ftth_onu_registro
        ADD COLUMN IF NOT EXISTS tr069_bootstrap_aplicado BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS mgmt_service_port_id INT,
        ADD COLUMN IF NOT EXISTS mgmt_vlan SMALLINT,
        ADD COLUMN IF NOT EXISTS mgmt_traffic_index INT,
        ADD COLUMN IF NOT EXISTS mgmt_priority SMALLINT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ftth_onu_registro
        DROP COLUMN IF EXISTS tr069_bootstrap_aplicado,
        DROP COLUMN IF EXISTS mgmt_service_port_id,
        DROP COLUMN IF EXISTS mgmt_vlan,
        DROP COLUMN IF EXISTS mgmt_traffic_index,
        DROP COLUMN IF EXISTS mgmt_priority;
    `);
  }
}
