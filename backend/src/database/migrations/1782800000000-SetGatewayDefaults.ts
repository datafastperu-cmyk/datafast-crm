import { MigrationInterface, QueryRunner } from 'typeorm';

export class SetGatewayDefaults1782800000000 implements MigrationInterface {
  name = 'SetGatewayDefaults1782800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nuevas instalaciones arrancan con DATAFAST_MENSAJERIA_MASIVA como proveedor,
    // instancia por defecto 'datafast_masivos' y pausa de 12 s entre mensajes.
    // Las empresas existentes no se modifican.
    await queryRunner.query(`
      ALTER TABLE empresas
        ALTER COLUMN proveedor_activo  SET DEFAULT 'DATAFAST_MENSAJERIA_MASIVA',
        ALTER COLUMN gateway_pausa     SET DEFAULT 12,
        ALTER COLUMN gateway_client_id SET DEFAULT 'datafast_masivos';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        ALTER COLUMN proveedor_activo  SET DEFAULT 'META_GRAPH',
        ALTER COLUMN gateway_pausa     SET DEFAULT 2,
        ALTER COLUMN gateway_client_id DROP DEFAULT;
    `);
  }
}
