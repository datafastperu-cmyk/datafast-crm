import { MigrationInterface, QueryRunner } from 'typeorm';

// Gateway/máscara de la VLAN de gestión — requeridos para el bootstrap TR-069
// ESTÁTICO (ver CreateOltMgmtIpPool1791800000003 para la causa raíz que reemplazó
// el enfoque DHCP). Portabilidad multi-VPS: valores configurables por OLT, nunca
// hardcodeados en código.
export class AddMgmtGatewayMaskToOltDispositivos1791800000004 implements MigrationInterface {
  name = 'AddMgmtGatewayMaskToOltDispositivos1791800000004';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_dispositivos
        ADD COLUMN IF NOT EXISTS tr069_mgmt_gateway VARCHAR(15),
        ADD COLUMN IF NOT EXISTS tr069_mgmt_mask    VARCHAR(15) DEFAULT '255.255.255.0'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_dispositivos
        DROP COLUMN IF EXISTS tr069_mgmt_gateway,
        DROP COLUMN IF EXISTS tr069_mgmt_mask
    `);
  }
}
