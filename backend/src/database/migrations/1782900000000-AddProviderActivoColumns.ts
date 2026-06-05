import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderActivoColumns1782900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS meta_graph_activo          BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS twilio_activo              BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS vonage_activo              BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS custom_api_activo          BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS automatizado_vip_activo    BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS meta_graph_activo,
        DROP COLUMN IF EXISTS twilio_activo,
        DROP COLUMN IF EXISTS vonage_activo,
        DROP COLUMN IF EXISTS custom_api_activo,
        DROP COLUMN IF EXISTS automatizado_vip_activo;
    `);
  }
}
