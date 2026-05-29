import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEntregadoLeidoToEstadoEntrega1781500000000 implements MigrationInterface {
  // ALTER TYPE … ADD VALUE cannot run inside a transaction on PostgreSQL < 12
  // and CREATE INDEX CONCURRENTLY is also disallowed in transactions.
  public readonly transaction = false;

  async up(qr: QueryRunner): Promise<void> {
    // ── 1. Expandir el enum ──────────────────────────────────────
    await qr.query(`ALTER TYPE notificaciones_estado_entrega ADD VALUE IF NOT EXISTS 'ENTREGADO';`);
    await qr.query(`ALTER TYPE notificaciones_estado_entrega ADD VALUE IF NOT EXISTS 'LEIDO';`);

    // ── 2. Índice parcial sobre meta_message_id para el webhook ──
    // Búsquedas de tracking son: WHERE meta_message_id = $1
    // El índice parcial ignora las filas con NULL (mayoría sin tracking).
    await qr.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notif_logs_meta_msg_id
        ON notificaciones_logs(meta_message_id)
        WHERE meta_message_id IS NOT NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_notif_logs_meta_msg_id;`);
    // PostgreSQL no permite eliminar valores de un ENUM sin recrear el tipo.
    // El down solo elimina el índice; los valores del enum quedan en la BD.
  }
}
