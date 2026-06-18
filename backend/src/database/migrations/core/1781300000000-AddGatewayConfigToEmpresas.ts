import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGatewayConfigToEmpresas1781300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE proveedor_mensajeria AS ENUM ('META_GRAPH','TWILIO','VONAGE','CUSTOM_API');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS proveedor_activo  proveedor_mensajeria NOT NULL DEFAULT 'META_GRAPH',
        ADD COLUMN IF NOT EXISTS gateway_api_key   TEXT        NULL,
        ADD COLUMN IF NOT EXISTS gateway_api_secret TEXT       NULL,
        ADD COLUMN IF NOT EXISTS gateway_client_id VARCHAR(120) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS proveedor_activo,
        DROP COLUMN IF EXISTS gateway_api_key,
        DROP COLUMN IF EXISTS gateway_api_secret,
        DROP COLUMN IF EXISTS gateway_client_id;
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS proveedor_mensajeria;`);
  }
}
