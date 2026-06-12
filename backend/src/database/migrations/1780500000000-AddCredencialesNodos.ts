import { MigrationInterface, QueryRunner } from 'typeorm';

// Agrega credenciales de acceso a equipos en la tabla nodos.
// Soporta RouterOS API (MikroTik), SNMP y SSH según fabricante.
export class AddCredencialesNodos1780500000000 implements MigrationInterface {
  name = 'AddCredencialesNodos1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Columnas de credenciales y método de conexión ─────────
    await queryRunner.query(`
      ALTER TABLE nodos
        ADD COLUMN IF NOT EXISTS usuario          VARCHAR(100),
        ADD COLUMN IF NOT EXISTS password_cifrado VARCHAR(500),
        ADD COLUMN IF NOT EXISTS fabricante       VARCHAR(100),
        ADD COLUMN IF NOT EXISTS puerto_api       SMALLINT     NOT NULL DEFAULT 8728,
        ADD COLUMN IF NOT EXISTS usar_ssl         BOOLEAN      NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS metodo_conexion  VARCHAR(20)  NOT NULL DEFAULT 'snmp'
    `);

    // ── Asegurar que el enum nodos_tipo_enum tenga todos los valores ─
    // ADD VALUE IF NOT EXISTS es idempotente en Postgres 12+
    const nuevosTipos = ['camara', 'alarma', 'otro'];
    for (const val of nuevosTipos) {
      await queryRunner.query(
        `ALTER TYPE nodos_tipo_enum ADD VALUE IF NOT EXISTS '${val}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE nodos
        DROP COLUMN IF EXISTS metodo_conexion,
        DROP COLUMN IF EXISTS usar_ssl,
        DROP COLUMN IF EXISTS puerto_api,
        DROP COLUMN IF EXISTS fabricante,
        DROP COLUMN IF EXISTS password_cifrado,
        DROP COLUMN IF EXISTS usuario
    `);
  }
}
