import { MigrationInterface, QueryRunner } from 'typeorm';

// Nuevo estado `fallido_rollback` para el invariante de atomicidad hardware↔ERP:
// si el rollback en la OLT falla, el registro NUNCA se borra (dejaría un `ont` huérfano
// en la OLT sin contrato). Se conserva en este estado + ultimoError, con los pools
// retenidos, hasta que el watcher confirme la limpieza real de la OLT.
//
// ALTER TYPE ... ADD VALUE no puede ejecutarse dentro de una transacción (PG < 14) →
// transaction = false. Aditiva: Postgres no permite quitar valores de un enum (down no-op).
export class AddFallidoRollbackFtthEstado1791800000008 implements MigrationInterface {
  name = 'AddFallidoRollbackFtthEstado1791800000008';
  transaction = false;

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TYPE ftth_onu_estado ADD VALUE IF NOT EXISTS 'fallido_rollback'`);
  }

  public async down(): Promise<void> {
    // Postgres no permite DROP VALUE de un enum — no-op.
  }
}
