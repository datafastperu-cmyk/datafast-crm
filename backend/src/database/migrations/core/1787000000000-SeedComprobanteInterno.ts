import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedComprobanteInterno1787000000000 implements MigrationInterface {
  name = 'SeedComprobanteInterno1787000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Agregar columna es_protegido a comprobantes_config
    await queryRunner.query(`
      ALTER TABLE comprobantes_config
      ADD COLUMN IF NOT EXISTS es_protegido BOOLEAN NOT NULL DEFAULT false
    `);

    // 2. Seed "COMPROBANTE INTERNO" para cada empresa.
    //    Se establece como default SOLO si la empresa no tiene otro default.
    //    ON CONFLICT: si ya existe con código 'ci', solo marcar como protegido.
    await queryRunner.query(`
      INSERT INTO comprobantes_config (
        empresa_id, nombre, codigo, tiene_carga_fiscal,
        serie, correlativo_actual, es_default, es_protegido, activo
      )
      SELECT
        e.id,
        'Comprobante Interno',
        'ci',
        false,
        'CI',
        0,
        NOT EXISTS (
          SELECT 1 FROM comprobantes_config cc
          WHERE cc.empresa_id = e.id
            AND cc.es_default = true
            AND cc.deleted_at IS NULL
        ),
        true,
        true
      FROM empresas e
      WHERE e.deleted_at IS NULL
      ON CONFLICT (empresa_id, codigo) DO UPDATE
        SET es_protegido = true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Eliminar el comprobante interno sembrado (solo el protegido con código 'ci')
    await queryRunner.query(`
      DELETE FROM comprobantes_config
      WHERE codigo = 'ci' AND es_protegido = true
    `);

    await queryRunner.query(`
      ALTER TABLE comprobantes_config
      DROP COLUMN IF EXISTS es_protegido
    `);
  }
}
