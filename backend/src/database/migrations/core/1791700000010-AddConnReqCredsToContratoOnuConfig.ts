import { MigrationInterface, QueryRunner } from 'typeorm';

// Credenciales ConnectionRequest ÚNICAS por ONU (recomendación del experto: ConnReq user
// único por ONU, no global). Auth ACS→ONU: GenieACS las usa para alcanzar la ONU on-demand.
//   connreq_username = usuario ConnReq (ManagementServer.ConnectionRequestUsername)
//   connreq_password = clave ConnReq (CIFRADA por la capa de servicio)
export class AddConnReqCredsToContratoOnuConfig1791700000010 implements MigrationInterface {
  name = 'AddConnReqCredsToContratoOnuConfig1791700000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        ADD COLUMN IF NOT EXISTS connreq_username VARCHAR(64),
        ADD COLUMN IF NOT EXISTS connreq_password TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contrato_onu_config
        DROP COLUMN IF EXISTS connreq_username,
        DROP COLUMN IF EXISTS connreq_password;
    `);
  }
}
