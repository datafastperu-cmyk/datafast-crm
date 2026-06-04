import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDatafastProveedoresToEnum1782700000000 implements MigrationInterface {
  name = 'AddDatafastProveedoresToEnum1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE proveedor_mensajeria ADD VALUE IF NOT EXISTS 'DATAFAST_NATIVE'`);
    await queryRunner.query(`ALTER TYPE proveedor_mensajeria ADD VALUE IF NOT EXISTS 'DATAFAST_MENSAJERIA_MASIVA'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL no permite DROP VALUE de un enum; la reversión requiere recrear el tipo
  }
}
