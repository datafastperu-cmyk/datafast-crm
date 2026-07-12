import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContratoOnuConfigTable1791700000004 implements MigrationInterface {
  name = 'CreateContratoOnuConfigTable1791700000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contrato_onu_config (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id               UUID NOT NULL,
        contrato_id              UUID NOT NULL,
        wifi_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
        wifi_ssid                VARCHAR(64),
        wifi_password            TEXT,
        wifi_password_generated  BOOLEAN NOT NULL DEFAULT TRUE,
        last_generated_at        TIMESTAMPTZ,
        wifi5g_ssid              VARCHAR(64),
        wifi5g_password          TEXT,
        voip_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
        voip_user                VARCHAR(64),
        voip_password            TEXT,
        provisioning_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
        revision                 INT NOT NULL DEFAULT 1,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at               TIMESTAMPTZ,
        version                  INTEGER NOT NULL DEFAULT 1
      );
    `);

    // Una config por contrato (ignora soft-deleted).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contrato_onu_config_contrato
        ON contrato_onu_config (contrato_id)
        WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contrato_onu_config`);
  }
}
