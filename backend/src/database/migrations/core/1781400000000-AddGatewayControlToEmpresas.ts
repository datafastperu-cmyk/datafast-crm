import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGatewayControlToEmpresas1781400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        ADD COLUMN IF NOT EXISTS gateway_pausa              SMALLINT    NOT NULL DEFAULT 2,
        ADD COLUMN IF NOT EXISTS gateway_limite_caracteres  INT         NOT NULL DEFAULT 1000,
        ADD COLUMN IF NOT EXISTS gateway_codigo_pais        VARCHAR(10) NOT NULL DEFAULT '+51',
        ADD COLUMN IF NOT EXISTS gateway_activo             BOOLEAN     NOT NULL DEFAULT TRUE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE empresas
        DROP COLUMN IF EXISTS gateway_pausa,
        DROP COLUMN IF EXISTS gateway_limite_caracteres,
        DROP COLUMN IF EXISTS gateway_codigo_pais,
        DROP COLUMN IF EXISTS gateway_activo;
    `);
  }
}
