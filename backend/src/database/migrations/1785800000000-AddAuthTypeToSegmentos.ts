import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthTypeToSegmentos1785800000000 implements MigrationInterface {
  name = 'AddAuthTypeToSegmentos1785800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE segmentos_ipv4
        ADD COLUMN IF NOT EXISTS auth_type VARCHAR(25)
          NOT NULL DEFAULT 'pppoe'
          CHECK (auth_type IN ('pppoe', 'amarre_ip_mac', 'amarre_ip_mac_dhcp'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE segmentos_ipv4 DROP COLUMN IF EXISTS auth_type
    `);
  }
}
