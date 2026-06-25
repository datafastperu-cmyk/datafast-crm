import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingColumnsPromesasPago1789000000000 implements MigrationInterface {
  name = 'AddMissingColumnsPromesasPago1789000000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE promesas_pago
        ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ        NULL,
        ADD COLUMN IF NOT EXISTS version     INTEGER NOT NULL   DEFAULT 1
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE promesas_pago
        DROP COLUMN IF EXISTS deleted_at,
        DROP COLUMN IF EXISTS version
    `);
  }
}
