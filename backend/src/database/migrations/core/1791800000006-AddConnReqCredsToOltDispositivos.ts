import { MigrationInterface, QueryRunner } from 'typeorm';

// Connection Request: credenciales que el ACS usa para conectarse DE VUELTA al
// CPE (operaciones inmediatas, ej. "reboot ahora"). Sin esto la ONU solo puede
// ser gestionada de forma pasiva vía sus Informs periódicos. Completa el set
// ACS URL/Username/Password + ConnReq Username/Password que se inyecta en el
// carril TR-069 (ver ProvisioningStrategyResolver / cpe-provisioning-catalog.ts).
export class AddConnReqCredsToOltDispositivos1791800000006 implements MigrationInterface {
  name = 'AddConnReqCredsToOltDispositivos1791800000006';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_dispositivos
        ADD COLUMN IF NOT EXISTS tr069_connreq_username VARCHAR(100),
        ADD COLUMN IF NOT EXISTS tr069_connreq_password TEXT
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_dispositivos
        DROP COLUMN IF EXISTS tr069_connreq_username,
        DROP COLUMN IF EXISTS tr069_connreq_password
    `);
  }
}
