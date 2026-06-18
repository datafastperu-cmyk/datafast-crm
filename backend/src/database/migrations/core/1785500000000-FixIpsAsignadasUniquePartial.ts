import { MigrationInterface, QueryRunner } from 'typeorm';

// La constraint UNIQUE (segmento_id, ip_address) en ips_asignadas es global.
// Cuando liberarIp() marca activa=false (sin borrar la fila), el siguiente
// intento de asignar la misma IP falla con 23505 porque la fila inactiva
// sigue bloqueando el constraint.
// Fix: constraint parcial WHERE activa = true + borrar filas inactivas.
export class FixIpsAsignadasUniquePartial1785500000000 implements MigrationInterface {
  name = 'FixIpsAsignadasUniquePartial1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar constraint global
    await queryRunner.query(`
      ALTER TABLE ips_asignadas
        DROP CONSTRAINT IF EXISTS ips_asignadas_segmento_id_ip_address_key
    `);

    // 2. Limpiar filas inactivas que bloquean reasignación del mismo IP
    await queryRunner.query(`
      DELETE FROM ips_asignadas WHERE activa = false
    `);

    // 3. Índice único parcial: solo un registro activo por IP por segmento
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ips_asignadas_segmento_ip_activa
        ON ips_asignadas (segmento_id, ip_address)
        WHERE activa = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_ips_asignadas_segmento_ip_activa`);
    await queryRunner.query(`
      ALTER TABLE ips_asignadas
        ADD CONSTRAINT ips_asignadas_segmento_id_ip_address_key UNIQUE (segmento_id, ip_address)
    `);
  }
}
