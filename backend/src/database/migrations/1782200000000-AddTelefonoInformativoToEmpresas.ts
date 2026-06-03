import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelefonoInformativoToEmpresas1782200000000 implements MigrationInterface {
  name = 'AddTelefonoInformativoToEmpresas1782200000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS telefono_informativo VARCHAR(30) NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS telefono_informativo;`);
  }
}
