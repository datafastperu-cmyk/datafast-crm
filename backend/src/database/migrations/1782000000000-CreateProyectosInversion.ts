import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProyectosInversion1782000000000 implements MigrationInterface {
  name = 'CreateProyectosInversion1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      CREATE TYPE estado_proyecto_inversion AS ENUM (
        'activo',
        'completado',
        'cancelado'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE proyectos_inversion (
        id                UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id        UUID                        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre_proyecto   VARCHAR(200)                NOT NULL,
        sector_id         UUID                        NOT NULL REFERENCES zonas(id),
        inversion_inicial DECIMAL(14, 2)              NOT NULL,
        tasa_descuento    DECIMAL(6, 4)               NOT NULL
          CONSTRAINT chk_tasa_descuento CHECK (tasa_descuento BETWEEN 0.001 AND 0.99),
        fecha_inicio      DATE                        NOT NULL,
        descripcion       TEXT,
        estado            estado_proyecto_inversion    NOT NULL DEFAULT 'activo',
        created_at        TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_proyectos_inversion_empresa_sector
        ON proyectos_inversion (empresa_id, sector_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS proyectos_inversion`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_proyecto_inversion`);
  }
}
