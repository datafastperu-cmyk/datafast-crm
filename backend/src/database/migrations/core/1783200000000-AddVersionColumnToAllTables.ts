import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega columna `version` (INTEGER, DEFAULT 1, NOT NULL) a todas las tablas
 * que extienden BaseModel, habilitando bloqueo optimista de concurrencia via
 * TypeORM @VersionColumn().
 *
 * Tablas afectadas: las 18 entidades que extienden BaseModel.
 * Registros existentes quedan en version=1 (baseline).
 */
export class AddVersionColumnToAllTables1783200000000 implements MigrationInterface {
  name = 'AddVersionColumnToAllTables1783200000000';

  private readonly tables = [
    'clientes',
    'contratos',
    'facturas',
    'planes',
    'routers',
    'usuarios',
    'roles',
    'segmentos_ipv4',
    'vpn_clientes',
    'openvpn_config',
    'plantillas_mensajes',
    'plantillas_abonados',
    'olts',
    'onus',
    'olt_dispositivos',
    'backups',
    'google_accounts',
    'google_sync_logs',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          DROP COLUMN IF EXISTS version
      `);
    }
  }
}
