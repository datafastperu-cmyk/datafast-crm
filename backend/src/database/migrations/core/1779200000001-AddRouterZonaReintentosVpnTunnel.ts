import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRouterZonaReintentosVpnTunnel1779200000001 implements MigrationInterface {
  name = 'AddRouterZonaReintentosVpnTunnel1779200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agregar nuevo valor al ENUM (operación no destructiva en PostgreSQL)
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = 'metodo_conexion_router'::regtype
            AND enumlabel = 'vpn_tunnel'
        ) THEN
          ALTER TYPE metodo_conexion_router ADD VALUE 'vpn_tunnel';
        END IF;
      END $$
    `);

    // Agregar columnas zona y reintentos
    await queryRunner.query(`
      ALTER TABLE routers
        ADD COLUMN IF NOT EXISTS zona       VARCHAR(100),
        ADD COLUMN IF NOT EXISTS reintentos SMALLINT NOT NULL DEFAULT 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE routers
        DROP COLUMN IF EXISTS zona,
        DROP COLUMN IF EXISTS reintentos
    `);
    // No se puede eliminar un valor de un ENUM en PostgreSQL sin recrear el tipo
  }
}
