import { MigrationInterface, QueryRunner } from 'typeorm';

// Config real de SNMP/NTP leída de la OLT (no lo que el ERP asume que está
// configurado). Se puebla en cada OltSyncService._ejecutarSync junto con
// boards/vlans — mismo patrón, best-effort, no bloquea el sync si falla.
//   snmp_real_communities = [{name, access}] tal como reporta la OLT
//   snmp_real_versions    = ['SNMPv1','SNMPv2c','SNMPv3']
//   ntp_servers            = [{source, stratum, reach, status}]
//   config_snapshot_at     = cuándo se leyó por última vez (frescura, igual
//                            que ultimoSyncEn en InfrastructureSnapshot)
export class AddSnmpNtpConfigToOltDispositivos1791700000012 implements MigrationInterface {
  name = 'AddSnmpNtpConfigToOltDispositivos1791700000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        ADD COLUMN IF NOT EXISTS snmp_real_communities JSONB,
        ADD COLUMN IF NOT EXISTS snmp_real_versions    JSONB,
        ADD COLUMN IF NOT EXISTS ntp_servers            JSONB,
        ADD COLUMN IF NOT EXISTS config_snapshot_at     TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        DROP COLUMN IF EXISTS snmp_real_communities,
        DROP COLUMN IF EXISTS snmp_real_versions,
        DROP COLUMN IF EXISTS ntp_servers,
        DROP COLUMN IF EXISTS config_snapshot_at;
    `);
  }
}
