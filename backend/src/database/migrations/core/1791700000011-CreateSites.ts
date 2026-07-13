import { MigrationInterface, QueryRunner } from 'typeorm';

// Incremento 1 del roadmap de arquitectura de infraestructura:
// entidad Site que agrupa Router MikroTik + VPN + OLT bajo un mismo
// nodo de red. Migración puramente aditiva — no toca tablas existentes.
//   router_id = FK 1:1 al Router de cabecera (nullable en esta fase)
export class CreateSites1791700000011 implements MigrationInterface {
  name = 'CreateSites1791700000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   UUID NOT NULL,
        nombre       VARCHAR(150) NOT NULL,
        descripcion  TEXT,
        ubicacion    VARCHAR(200),
        latitud      DECIMAL(10,7),
        longitud     DECIMAL(10,7),
        zona_id      UUID,
        router_id    UUID,
        activo       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at   TIMESTAMPTZ,
        version      INTEGER NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sites_empresa_activo
        ON sites (empresa_id, activo);
    `);

    // Único mientras esté activo — un Router de cabecera pertenece a un solo Site.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_router
        ON sites (router_id)
        WHERE deleted_at IS NULL AND router_id IS NOT NULL;
    `);

    // FK a routers — ON DELETE RESTRICT: no se puede borrar el router
    // si tiene un Site asociado (misma política que olt_dispositivos.router_id).
    await queryRunner.query(`
      ALTER TABLE sites
        ADD CONSTRAINT fk_sites_router
        FOREIGN KEY (router_id) REFERENCES routers(id)
        ON DELETE RESTRICT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sites;`);
  }
}
