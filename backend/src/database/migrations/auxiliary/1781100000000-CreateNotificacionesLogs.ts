import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificacionesLogs1781100000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      DO $$ BEGIN
        CREATE TYPE notificaciones_estado_entrega AS ENUM ('ENCOLADO', 'ENVIADO_META', 'FALLIDO');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS notificaciones_logs (
        id              UUID         NOT NULL DEFAULT gen_random_uuid(),
        contrato_id     UUID         NULL REFERENCES contratos(id) ON DELETE SET NULL,
        telefono        VARCHAR(30)  NOT NULL,
        canal           VARCHAR(20)  NOT NULL DEFAULT 'WHATSAPP',
        tipo_template   VARCHAR(50)  NOT NULL,
        estado_entrega  notificaciones_estado_entrega NOT NULL DEFAULT 'ENCOLADO',
        meta_message_id VARCHAR(100) NULL,
        error_detalle   TEXT         NULL,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_notificaciones_logs PRIMARY KEY (id)
      );
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_logs_contrato
        ON notificaciones_logs(contrato_id);
      CREATE INDEX IF NOT EXISTS idx_notif_logs_created_at
        ON notificaciones_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notif_logs_estado
        ON notificaciones_logs(estado_entrega);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS notificaciones_logs;`);
    await qr.query(`DROP TYPE IF EXISTS notificaciones_estado_entrega;`);
  }
}
