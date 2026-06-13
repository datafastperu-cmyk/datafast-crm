import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingClienteColumns1784600000000 implements MigrationInterface {
  name = 'AddMissingClienteColumns1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clientes
        ADD COLUMN IF NOT EXISTS nota_baja            TEXT,
        ADD COLUMN IF NOT EXISTS zona_id              UUID REFERENCES zonas(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS facturacion_config   JSONB,
        ADD COLUMN IF NOT EXISTS notificaciones_config JSONB
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_clientes_zona
        ON clientes (zona_id) WHERE deleted_at IS NULL AND zona_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_clientes_zona`);
    await queryRunner.query(`
      ALTER TABLE clientes
        DROP COLUMN IF EXISTS nota_baja,
        DROP COLUMN IF EXISTS zona_id,
        DROP COLUMN IF EXISTS facturacion_config,
        DROP COLUMN IF EXISTS notificaciones_config
    `);
  }
}
