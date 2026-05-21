import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDominioToEmpresas1780100000001 implements MigrationInterface {
  name = 'AddDominioToEmpresas1780100000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominio VARCHAR(250)`);
    await queryRunner.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS notif_whatsapp_vencimiento BOOLEAN NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS notif_whatsapp_corte BOOLEAN NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS notif_whatsapp_vencimiento`);
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS notif_whatsapp_corte`);
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS dominio`);
  }
}
