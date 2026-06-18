import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAntenaApIdToContratos1784500000000 implements MigrationInterface {
  name = 'AddAntenaApIdToContratos1784500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        ADD COLUMN IF NOT EXISTS antena_ap_id UUID
          REFERENCES dispositivos_monitoreo(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_contratos_antena_ap
        ON contratos (antena_ap_id) WHERE deleted_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contratos_antena_ap`);
    await queryRunner.query(`ALTER TABLE contratos DROP COLUMN IF EXISTS antena_ap_id`);
  }
}
