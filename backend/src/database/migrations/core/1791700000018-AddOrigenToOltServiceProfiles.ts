import { MigrationInterface, QueryRunner } from 'typeorm';

// Gestión de tipos de ONU (ont-srvprofile): ownership para distinguir los
// creados por el ERP (sello DATAFAST, gestionables) de los preexistentes
// (solo informativos). Migración aditiva; lo existente queda como 'olt'.
export class AddOrigenToOltServiceProfiles1791700000018 implements MigrationInterface {
  name = 'AddOrigenToOltServiceProfiles1791700000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_service_profiles
        ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'olt';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_service_profiles DROP COLUMN IF EXISTS origen;
    `);
  }
}
