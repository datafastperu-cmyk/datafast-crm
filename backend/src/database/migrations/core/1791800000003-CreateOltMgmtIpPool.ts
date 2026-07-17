import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Pool de IPs estáticas de gestión TR-069 (Incidente 2026-07-17, CNT-2026-000004)
//
// Ingeniería inversa contra una ONU aprovisionada por SmartOLT confirmó la causa
// raíz real del carril de gestión roto: el IP-host de gestión (ip-index 0) SOLO
// materializa tráfico cuando se configura ESTÁTICO — el modo DHCP nunca funcionó
// en ningún firmware/hardware probado (2 ONUs, 2 firmwares, verificado con
// sniffer). SmartOLT usa IP estática sobre su propia VLAN 1500; el ERP replica
// el mecanismo (estático, no DHCP) sobre la VLAN de gestión CANÓNICA propia
// (DATAFAST_GESTION_1600) — nunca reutiliza la infraestructura de SmartOLT.
// ─────────────────────────────────────────────────────────────
export class CreateOltMgmtIpPool1791800000003 implements MigrationInterface {
  name = 'CreateOltMgmtIpPool1791800000003';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE olt_mgmt_ip_pool (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id  UUID        NOT NULL,
        olt_id      UUID        NOT NULL REFERENCES olt_dispositivos(id) ON DELETE CASCADE,
        ip_address  INET        NOT NULL,
        estado      VARCHAR(20) NOT NULL DEFAULT 'libre',
        contrato_id UUID,
        locked_at   TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ,
        version     INTEGER     NOT NULL DEFAULT 1,
        CONSTRAINT uq_mip_olt_ip UNIQUE (olt_id, ip_address)
      )
    `);

    await qr.query(`
      CREATE INDEX idx_mip_empresa
        ON olt_mgmt_ip_pool(empresa_id)
        WHERE deleted_at IS NULL
    `);

    await qr.query(`
      CREATE INDEX idx_mip_olt_libre
        ON olt_mgmt_ip_pool(olt_id, ip_address ASC)
        WHERE estado = 'libre' AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS olt_mgmt_ip_pool`);
  }
}
