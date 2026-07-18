import { MigrationInterface, QueryRunner } from 'typeorm';

// Las credenciales del ACS (URL/usuario/clave/ConnReq) dejan de ser un dato por
// OLT: pasan a ser config de plataforma (una sola instancia de GenieACS por
// instalación del ERP) — ver backend/src/config/tr069-acs.config.ts (.env).
// Los parámetros de RED (mgmtVlan/mgmtGateway/mgmtMask) sí siguen siendo por OLT
// y no se tocan aquí.
export class DropAcsCredsFromOltDispositivos1791800000007 implements MigrationInterface {
  name = 'DropAcsCredsFromOltDispositivos1791800000007';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_dispositivos
        DROP COLUMN IF EXISTS tr069_acs_url,
        DROP COLUMN IF EXISTS tr069_acs_username,
        DROP COLUMN IF EXISTS tr069_acs_password,
        DROP COLUMN IF EXISTS tr069_connreq_username,
        DROP COLUMN IF EXISTS tr069_connreq_password
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_dispositivos
        ADD COLUMN IF NOT EXISTS tr069_acs_url VARCHAR(255),
        ADD COLUMN IF NOT EXISTS tr069_acs_username VARCHAR(100),
        ADD COLUMN IF NOT EXISTS tr069_acs_password TEXT,
        ADD COLUMN IF NOT EXISTS tr069_connreq_username VARCHAR(100),
        ADD COLUMN IF NOT EXISTS tr069_connreq_password TEXT
    `);
  }
}
