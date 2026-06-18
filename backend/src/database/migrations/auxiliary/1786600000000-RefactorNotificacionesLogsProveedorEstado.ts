import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 2 del refactor del módulo de notificaciones inteligentes:
// - Renombra ENVIADO_META → ENVIADO (el estado aplica a cualquier proveedor)
// - Renombra meta_message_id → provider_message_id
// - Agrega columna proveedor (qué proveedor ejecutó el envío)
export class RefactorNotificacionesLogsProveedorEstado1786600000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    // 1. Renombrar valor del enum (PG ≥ 10)
    await qr.query(
      `ALTER TYPE notificaciones_estado_entrega RENAME VALUE 'ENVIADO_META' TO 'ENVIADO';`,
    );

    // 2. Renombrar columna meta_message_id → provider_message_id
    await qr.query(
      `ALTER TABLE notificaciones_logs RENAME COLUMN meta_message_id TO provider_message_id;`,
    );

    // 3. Agregar columna proveedor
    await qr.query(
      `ALTER TABLE notificaciones_logs ADD COLUMN IF NOT EXISTS proveedor VARCHAR(40) NULL;`,
    );

    // 4. Actualizar índice que referenciaba el nombre antiguo
    await qr.query(`DROP INDEX IF EXISTS idx_notif_logs_meta_msg_id;`);
    await qr.query(
      `CREATE INDEX IF NOT EXISTS idx_notif_logs_provider_msg_id ON notificaciones_logs (provider_message_id);`,
    );
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_notif_logs_provider_msg_id;`);
    await qr.query(
      `CREATE INDEX IF NOT EXISTS idx_notif_logs_meta_msg_id ON notificaciones_logs (provider_message_id);`,
    );
    await qr.query(
      `ALTER TABLE notificaciones_logs DROP COLUMN IF EXISTS proveedor;`,
    );
    await qr.query(
      `ALTER TABLE notificaciones_logs RENAME COLUMN provider_message_id TO meta_message_id;`,
    );
    await qr.query(
      `ALTER TYPE notificaciones_estado_entrega RENAME VALUE 'ENVIADO' TO 'ENVIADO_META';`,
    );
  }
}
