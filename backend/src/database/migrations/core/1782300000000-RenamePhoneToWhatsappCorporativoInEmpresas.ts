import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePhoneToWhatsappCorporativoInEmpresas1782300000000 implements MigrationInterface {
  name = 'RenamePhoneToWhatsappCorporativoInEmpresas1782300000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE empresas RENAME COLUMN telefono TO whatsapp_corporativo;`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE empresas RENAME COLUMN whatsapp_corporativo TO telefono;`);
  }
}
