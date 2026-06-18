import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingPlanesColumns1784800000000 implements MigrationInterface {
  name = 'AddMissingPlanesColumns1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Columnas presentes en la entidad pero ausentes en la tabla
    await queryRunner.query(`
      ALTER TABLE planes
        ADD COLUMN IF NOT EXISTS crear_reglas_en_router BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS rate_limit             VARCHAR(50)
    `);

    // El CHECK original exige > 0, pero la entidad/DTO permiten 0
    // (planes sin reglas MikroTik pueden tener velocidad 0)
    await queryRunner.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'planes'::regclass AND contype = 'c'
            AND (pg_get_constraintdef(oid) LIKE '%velocidad_bajada%'
              OR pg_get_constraintdef(oid) LIKE '%velocidad_subida%')
        LOOP
          EXECUTE 'ALTER TABLE planes DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
        END LOOP;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE planes DROP COLUMN IF EXISTS crear_reglas_en_router`);
    await queryRunner.query(`ALTER TABLE planes DROP COLUMN IF EXISTS rate_limit`);
    await queryRunner.query(`ALTER TABLE planes ADD CONSTRAINT planes_velocidad_bajada_check CHECK (velocidad_bajada > 0)`);
    await queryRunner.query(`ALTER TABLE planes ADD CONSTRAINT planes_velocidad_subida_check CHECK (velocidad_subida > 0)`);

  }
}
