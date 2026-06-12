import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDispositivosMonitoreo1784200000000 implements MigrationInterface {
  name = 'CreateDispositivosMonitoreo1784200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_equipo_enum') THEN
          CREATE TYPE tipo_equipo_enum AS ENUM (
            'ANTENA_AP', 'ROUTER_BORDE', 'ROUTER_ACCESO', 'CAMARA_IP', 'DISPOSITIVO_CRITICO'
          );
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fabricante_enum') THEN
          CREATE TYPE fabricante_enum AS ENUM ('MIKROTIK', 'UBIQUITI', 'GENERICO');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_dispositivo_enum') THEN
          CREATE TYPE status_dispositivo_enum AS ENUM (
            'ONLINE', 'OFFLINE', 'REVERIFICANDO', 'DEGRADADO'
          );
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dispositivos_monitoreo (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id            VARCHAR NOT NULL,
        nombre_emisor         VARCHAR(120) NOT NULL,
        ip_address            VARCHAR(45) NOT NULL,
        router_acceso_id      UUID,
        tipo_equipo           tipo_equipo_enum NOT NULL DEFAULT 'ROUTER_ACCESO',
        fabricante            fabricante_enum NOT NULL DEFAULT 'MIKROTIK',
        modelo_nombre         VARCHAR(100),
        usuario               VARCHAR(64),
        contrasena_cifrada    TEXT,
        puerto_api            INTEGER NOT NULL DEFAULT 8728,
        use_ssl               BOOLEAN NOT NULL DEFAULT FALSE,
        monitoreo_snmp        BOOLEAN NOT NULL DEFAULT FALSE,
        intervalo_chequeo_seg INTEGER NOT NULL DEFAULT 60,
        status                status_dispositivo_enum NOT NULL DEFAULT 'ONLINE',
        last_seen_at          TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at            TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_disp_mon_empresa ON dispositivos_monitoreo (empresa_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_disp_mon_status  ON dispositivos_monitoreo (status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_disp_mon_router  ON dispositivos_monitoreo (router_acceso_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_disp_mon_ip      ON dispositivos_monitoreo (ip_address)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS dispositivos_monitoreo`);
    await queryRunner.query(`DROP TYPE IF EXISTS status_dispositivo_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS fabricante_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_equipo_enum`);
  }
}
