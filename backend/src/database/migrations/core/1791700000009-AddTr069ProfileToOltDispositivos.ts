import { MigrationInterface, QueryRunner } from 'typeorm';

// Perfil TR-069 por OLT (equivalente al "TR069 Profile" de SmartOLT).
//   tr069_enabled      = ¿el carril de gestión TR-069 está disponible en esta OLT?
//   tr069_acs_url      = CWMP ACS URL alcanzable desde la VLAN de gestión (ej. http://10.8.1.1:7547)
//   tr069_mgmt_vlan    = VLAN de gestión para el bootstrap (DHCP Option 43)
//   tr069_acs_username = usuario CWMP (ManagementServer.Username) — auth ONU→ACS
//   tr069_acs_password = clave CWMP (CIFRADA por la capa de servicio)
export class AddTr069ProfileToOltDispositivos1791700000009 implements MigrationInterface {
  name = 'AddTr069ProfileToOltDispositivos1791700000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        ADD COLUMN IF NOT EXISTS tr069_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS tr069_acs_url      VARCHAR(255),
        ADD COLUMN IF NOT EXISTS tr069_mgmt_vlan    SMALLINT,
        ADD COLUMN IF NOT EXISTS tr069_acs_username VARCHAR(100),
        ADD COLUMN IF NOT EXISTS tr069_acs_password TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        DROP COLUMN IF EXISTS tr069_enabled,
        DROP COLUMN IF EXISTS tr069_acs_url,
        DROP COLUMN IF EXISTS tr069_mgmt_vlan,
        DROP COLUMN IF EXISTS tr069_acs_username,
        DROP COLUMN IF EXISTS tr069_acs_password;
    `);
  }
}
