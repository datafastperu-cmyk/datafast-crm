import { MigrationInterface, QueryRunner } from 'typeorm';

// Incremento 5 — convergencia real: estado deseado de NTP declarado por el
// ERP. Simétrico a ntp_servers (estado real, ya existente) — uno es "lo que
// quiero", el otro "lo que hay". Migración aditiva.
export class AddNtpServersDeseadosToOltDispositivos1791700000013 implements MigrationInterface {
  name = 'AddNtpServersDeseadosToOltDispositivos1791700000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        ADD COLUMN IF NOT EXISTS ntp_servers_deseados JSONB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_dispositivos
        DROP COLUMN IF EXISTS ntp_servers_deseados;
    `);
  }
}
