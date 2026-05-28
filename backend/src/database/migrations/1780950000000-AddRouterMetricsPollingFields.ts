import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRouterMetricsPollingFields1780950000000 implements MigrationInterface {
  name = 'AddRouterMetricsPollingFields1780950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routers"
        ADD COLUMN IF NOT EXISTS "total_sesiones_pppoe" SMALLINT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routers" DROP COLUMN IF EXISTS "total_sesiones_pppoe"
    `);
  }
}
