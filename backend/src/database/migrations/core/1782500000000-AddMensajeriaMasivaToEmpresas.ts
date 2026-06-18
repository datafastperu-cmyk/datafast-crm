import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMensajeriaMasivaToEmpresas1782500000000 implements MigrationInterface {
  name = 'AddMensajeriaMasivaToEmpresas1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
      ADD COLUMN IF NOT EXISTS whatsapp_numero_origen VARCHAR(30) DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
      DROP COLUMN IF EXISTS whatsapp_numero_origen
    `);
  }
}
