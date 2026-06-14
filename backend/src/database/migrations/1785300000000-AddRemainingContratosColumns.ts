import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRemainingContratosColumns1785300000000
  implements MigrationInterface
{
  name = 'AddRemainingContratosColumns1785300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Crear enum de tipo_pago si no existe
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contratos_tipo_pago_enum') THEN
          CREATE TYPE "public"."contratos_tipo_pago_enum" AS ENUM('prepago', 'postpago');
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE contratos
        ADD COLUMN IF NOT EXISTS dias_prorroga  SMALLINT NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS tipo_pago      "public"."contratos_tipo_pago_enum"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        DROP COLUMN IF EXISTS dias_prorroga,
        DROP COLUMN IF EXISTS tipo_pago
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."contratos_tipo_pago_enum"`);
  }
}
