import { MigrationInterface, QueryRunner } from 'typeorm';

export class RouterPasswordCifradoToText1783400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE routers ALTER COLUMN password_cifrado TYPE text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE routers ALTER COLUMN password_cifrado TYPE varchar(500)`);
  }
}
