import { MigrationInterface, QueryRunner } from 'typeorm';

// Gestión de line-profiles GPON: ownership (erp/olt) + datos del DBA propio
// que el ERP crea junto al perfil canónico. Aditiva; lo existente queda 'olt'.
export class AddOrigenDbaToOltLineProfiles1791700000019 implements MigrationInterface {
  name = 'AddOrigenDbaToOltLineProfiles1791700000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_line_profiles
        ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'olt',
        ADD COLUMN IF NOT EXISTS dba_profile_id INT NULL,
        ADD COLUMN IF NOT EXISTS dba_nombre VARCHAR(64) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_line_profiles
        DROP COLUMN IF EXISTS origen,
        DROP COLUMN IF EXISTS dba_profile_id,
        DROP COLUMN IF EXISTS dba_nombre;
    `);
  }
}
