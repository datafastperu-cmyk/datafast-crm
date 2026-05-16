import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlantillasMensajes1779000000001 implements MigrationInterface {
  name = 'CreatePlantillasMensajes1779000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE plantillas_mensajes (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   UUID NOT NULL,
        tipo         VARCHAR(20) NOT NULL,
        codigo       VARCHAR(50) NOT NULL,
        nombre       VARCHAR(150) NOT NULL,
        contenido    TEXT NOT NULL,
        activo       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at   TIMESTAMPTZ,
        CONSTRAINT uq_plantilla_empresa_tipo_codigo UNIQUE (empresa_id, tipo, codigo)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_plantillas_empresa_tipo ON plantillas_mensajes (empresa_id, tipo)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS plantillas_mensajes`);
  }
}
