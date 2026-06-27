import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migra el puerto de conexión de OLTs de Telnet (23) a SSH (22).
 *
 * Solo afecta registros donde puerto = 23 (el antiguo default de Telnet).
 * OLTs con puerto personalizado (≠ 23) no se modifican.
 *
 * Down: revierte a 23 para los mismos registros (los que ahora son 22).
 */
export class OltPortTelnetToSsh1789300000000 implements MigrationInterface {
  name = 'OltPortTelnetToSsh1789300000000';

  public async up(qr: QueryRunner): Promise<void> {
    // Actualizar puerto 23 → 22 en OLTs de método nativo_ssh
    await qr.query(`
      UPDATE olt_dispositivos
      SET    puerto = 22
      WHERE  puerto = 23
        AND  metodo_conexion = 'nativo_ssh'
    `);

    // Actualizar default de columna en esquema
    await qr.query(`
      ALTER TABLE olt_dispositivos
        ALTER COLUMN puerto SET DEFAULT 22
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE olt_dispositivos
        ALTER COLUMN puerto SET DEFAULT 23
    `);

    await qr.query(`
      UPDATE olt_dispositivos
      SET    puerto = 23
      WHERE  puerto = 22
        AND  metodo_conexion = 'nativo_ssh'
    `);
  }
}
