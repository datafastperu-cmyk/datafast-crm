import { MigrationInterface, QueryRunner } from 'typeorm';

// Incremento 9b — observed state del uplink: VLANs realmente taggeadas por
// puerto uplink, capturadas best-effort en cada sync. Distinción explícita
// Observed vs Desired (el baseline declara uplinkPort + vlans uplink:true).
// Migración aditiva.
export class AddUplinkVlansToOltDispositivos1791700000016 implements MigrationInterface {
  name = 'AddUplinkVlansToOltDispositivos1791700000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos ADD COLUMN IF NOT EXISTS uplink_vlans JSONB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos DROP COLUMN IF EXISTS uplink_vlans;
    `);
  }
}
