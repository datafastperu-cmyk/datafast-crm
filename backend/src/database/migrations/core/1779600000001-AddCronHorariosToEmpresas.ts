import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCronHorariosToEmpresas1779600000001 implements MigrationInterface {
  name = 'AddCronHorariosToEmpresas1779600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS cron_horarios JSONB NOT NULL DEFAULT '{
          "facturacion":   "05:00",
          "corte":         "06:00",
          "recordatorio1": "09:00",
          "recordatorio2": "12:00",
          "recordatorio3": "19:00"
        }'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS cron_horarios`);
  }
}
