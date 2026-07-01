import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveMetaGraphTwilioVonage1783100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Migrar empresas que usen los proveedores eliminados
    await queryRunner.query(`
      UPDATE empresas
      SET proveedor_activo = 'DATAFAST_MENSAJERIA_MASIVA'
      WHERE proveedor_activo::text IN ('META_GRAPH', 'TWILIO', 'VONAGE')
    `);

    // Cambiar columna a TEXT para poder recrear el enum
    await queryRunner.query(`
      ALTER TABLE empresas ALTER COLUMN proveedor_activo TYPE TEXT USING proveedor_activo::text
    `);

    // Eliminar enum viejo
    await queryRunner.query(`DROP TYPE IF EXISTS proveedor_mensajeria`);

    // Crear nuevo enum sin proveedores eliminados
    await queryRunner.query(`
      CREATE TYPE proveedor_mensajeria AS ENUM ('CUSTOM_API', 'AUTOMATIZADO_VIP', 'DATAFAST_MENSAJERIA_MASIVA', 'SMTP')
    `);

    // Reconvertir columna al nuevo enum
    await queryRunner.query(`
      ALTER TABLE empresas ALTER COLUMN proveedor_activo
        TYPE proveedor_mensajeria USING proveedor_activo::proveedor_mensajeria
    `);

    // Actualizar default
    await queryRunner.query(`
      ALTER TABLE empresas ALTER COLUMN proveedor_activo SET DEFAULT 'DATAFAST_MENSAJERIA_MASIVA'
    `);

    // Eliminar columnas de activación de proveedores removidos
    await queryRunner.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS meta_graph_activo,
        DROP COLUMN IF EXISTS twilio_activo,
        DROP COLUMN IF EXISTS vonage_activo
    `);

    // Eliminar columnas exclusivas de Meta Graph
    await queryRunner.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS whatsapp_token,
        DROP COLUMN IF EXISTS whatsapp_phone_id,
        DROP COLUMN IF EXISTS whatsapp_business_id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Restaurar columnas Meta Graph
    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS whatsapp_token       TEXT        NULL,
        ADD COLUMN IF NOT EXISTS whatsapp_phone_id    VARCHAR(60) NULL,
        ADD COLUMN IF NOT EXISTS whatsapp_business_id VARCHAR(60) NULL
    `);

    // Restaurar columnas de activación
    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS meta_graph_activo BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS twilio_activo     BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS vonage_activo     BOOLEAN NOT NULL DEFAULT false
    `);

    // Reconstruir enum original (con todos los proveedores)
    await queryRunner.query(`
      ALTER TABLE empresas ALTER COLUMN proveedor_activo TYPE TEXT USING proveedor_activo::text
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS proveedor_mensajeria`);
    await queryRunner.query(`
      CREATE TYPE proveedor_mensajeria AS ENUM (
        'META_GRAPH', 'TWILIO', 'VONAGE', 'CUSTOM_API', 'AUTOMATIZADO_VIP', 'DATAFAST_MENSAJERIA_MASIVA', 'SMTP'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE empresas ALTER COLUMN proveedor_activo
        TYPE proveedor_mensajeria USING proveedor_activo::proveedor_mensajeria
    `);
    await queryRunner.query(`
      ALTER TABLE empresas ALTER COLUMN proveedor_activo SET DEFAULT 'META_GRAPH'
    `);
  }
}
