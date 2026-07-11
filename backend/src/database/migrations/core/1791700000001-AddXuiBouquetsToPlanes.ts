import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddXuiBouquetsToPlanes1791700000001 implements MigrationInterface {
  name = 'AddXuiBouquetsToPlanes1791700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE planes
        ADD COLUMN IF NOT EXISTS xui_bouquet_ids JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE planes DROP COLUMN IF EXISTS xui_bouquet_ids`);
  }
}
