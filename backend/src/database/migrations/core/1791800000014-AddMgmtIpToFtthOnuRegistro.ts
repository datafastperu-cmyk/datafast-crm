import { MigrationInterface, QueryRunner } from 'typeorm';

// Fuente de verdad de la IP de gestión TR-069 en el registro FTTH (causa raíz
// 2026-07-24): el pool `olt_mgmt_ip_pool` guardaba la asignación por contrato, pero
// el registro no persistía la IP resultante — el modal, el reconciliador VIO y el
// ConnectionRequest no podían leerla sin joinear el pool, y un re-bootstrap podía
// desincronizar el rastro. Sticky por contrato (regla IP-VPN): se limpia solo al
// desaprovisionar. Ver AddMgmtGatewayMaskToOltDispositivos1791800000004 (perfil
// TR-069 de la OLT: gateway/mask/vlan) y CreateOltMgmtIpPool1791800000003 (el pool).
export class AddMgmtIpToFtthOnuRegistro1791800000014 implements MigrationInterface {
  name = 'AddMgmtIpToFtthOnuRegistro1791800000014';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE ftth_onu_registro
        ADD COLUMN IF NOT EXISTS mgmt_ip      VARCHAR(45),
        ADD COLUMN IF NOT EXISTS mgmt_ip_mode VARCHAR(12)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE ftth_onu_registro
        DROP COLUMN IF EXISTS mgmt_ip,
        DROP COLUMN IF EXISTS mgmt_ip_mode
    `);
  }
}
