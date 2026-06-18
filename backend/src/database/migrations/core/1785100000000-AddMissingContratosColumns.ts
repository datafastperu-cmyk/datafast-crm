import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega las columnas de red/antena/servicio que estaban en la entidad Contrato
 * pero nunca tuvieron migración dedicada.
 * Sin estas columnas los INSERT de TypeORM y el raw SELECT de findByClienteCompleto
 * fallaban con pg error 42703 ("column does not exist") → DATABASE_ERROR genérico.
 */
export class AddMissingContratosColumns1785100000000 implements MigrationInterface {
  name = 'AddMissingContratosColumns1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        ADD COLUMN IF NOT EXISTS excluir_firewall     BOOLEAN       NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS routes               TEXT,
        ADD COLUMN IF NOT EXISTS ip_administracion    VARCHAR(45),
        ADD COLUMN IF NOT EXISTS tipo_ipv4            VARCHAR(20)   DEFAULT 'estatica',
        ADD COLUMN IF NOT EXISTS descripcion_servicio TEXT,
        ADD COLUMN IF NOT EXISTS comunidad_snmp       VARCHAR(100),
        ADD COLUMN IF NOT EXISTS usuario_antena       VARCHAR(100),
        ADD COLUMN IF NOT EXISTS contrasena_antena    VARCHAR(500),
        ADD COLUMN IF NOT EXISTS caja_nap             VARCHAR(100),
        ADD COLUMN IF NOT EXISTS puerto_nap           VARCHAR(50),
        ADD COLUMN IF NOT EXISTS tipo_antena          VARCHAR(50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contratos
        DROP COLUMN IF EXISTS excluir_firewall,
        DROP COLUMN IF EXISTS routes,
        DROP COLUMN IF EXISTS ip_administracion,
        DROP COLUMN IF EXISTS tipo_ipv4,
        DROP COLUMN IF EXISTS descripcion_servicio,
        DROP COLUMN IF EXISTS comunidad_snmp,
        DROP COLUMN IF EXISTS usuario_antena,
        DROP COLUMN IF EXISTS contrasena_antena,
        DROP COLUMN IF EXISTS caja_nap,
        DROP COLUMN IF EXISTS puerto_nap,
        DROP COLUMN IF EXISTS tipo_antena
    `);
  }
}
