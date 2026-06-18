import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRouterTipoControlVelocidad1779400000001 implements MigrationInterface {
  name = 'AddRouterTipoControlVelocidad1779400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_control_velocidad_enum') THEN
          CREATE TYPE tipo_control_velocidad_enum AS ENUM (
            'ninguno', 'colas_simples', 'pcq_addresslist', 'dhcp_lease_queues'
          );
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE routers
        ADD COLUMN IF NOT EXISTS tipo_control_velocidad tipo_control_velocidad_enum NOT NULL DEFAULT 'ninguno'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE routers DROP COLUMN IF EXISTS tipo_control_velocidad`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_control_velocidad_enum`);
  }
}
