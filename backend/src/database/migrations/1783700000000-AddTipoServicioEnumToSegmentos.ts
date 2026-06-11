import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTipoServicioEnumToSegmentos1783700000000 implements MigrationInterface {
  name = 'AddTipoServicioEnumToSegmentos1783700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."segmentos_ipv4_tipo_servicio_enum" AS ENUM('ftth', 'wisp', 'dedicado')
    `);
    await queryRunner.query(`ALTER TABLE "segmentos_ipv4" ALTER COLUMN "tipo_servicio" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "segmentos_ipv4"
        ALTER COLUMN "tipo_servicio" TYPE "public"."segmentos_ipv4_tipo_servicio_enum"
        USING "tipo_servicio"::text::"public"."segmentos_ipv4_tipo_servicio_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "segmentos_ipv4"
        ALTER COLUMN "tipo_servicio" SET DEFAULT 'ftth'::"public"."segmentos_ipv4_tipo_servicio_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "segmentos_ipv4" ALTER COLUMN "tipo_servicio" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "segmentos_ipv4"
        ALTER COLUMN "tipo_servicio" TYPE VARCHAR(20)
        USING "tipo_servicio"::TEXT
    `);
    await queryRunner.query(`ALTER TABLE "segmentos_ipv4" ALTER COLUMN "tipo_servicio" SET DEFAULT 'ftth'`);
    await queryRunner.query(`DROP TYPE "public"."segmentos_ipv4_tipo_servicio_enum"`);
  }
}
