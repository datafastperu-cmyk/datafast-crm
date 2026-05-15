import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLicenciaEstado1778900000000 implements MigrationInterface {
  name = 'CreateLicenciaEstado1778900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "licencia_estado" (
        "id"                      SERIAL PRIMARY KEY,
        "licenseId"               VARCHAR(255) NOT NULL UNIQUE,
        "plan"                    VARCHAR(20)  NOT NULL,
        "maxClientes"             INTEGER      NOT NULL DEFAULT 100,
        "issuedTo"                VARCHAR(200),
        "machineId"               VARCHAR(64),
        "expiresAt"               TIMESTAMPTZ  NOT NULL,
        "lastOnlineValidatedAt"   TIMESTAMPTZ,
        "estado"                  VARCHAR(20)  NOT NULL DEFAULT 'pending',
        "licenseJwt"              TEXT         NOT NULL,
        "createdAt"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updatedAt"               TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_licencia_estado_licenseId"
      ON "licencia_estado" ("licenseId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "licencia_estado"`);
  }
}
