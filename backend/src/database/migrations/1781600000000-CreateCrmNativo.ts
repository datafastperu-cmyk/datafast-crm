import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCrmNativo1781600000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS crm_chats (
        id              UUID         NOT NULL DEFAULT gen_random_uuid(),
        empresa_id      UUID         NOT NULL,
        wa_chat_id      VARCHAR(60)  NOT NULL,
        telefono        VARCHAR(30)  NOT NULL,
        nombre_contacto VARCHAR(120) NULL,
        ultimo_mensaje  TEXT         NULL,
        ultimo_msg_at   TIMESTAMPTZ  NULL,
        no_leidos       SMALLINT     NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_crm_chats PRIMARY KEY (id),
        CONSTRAINT uq_crm_chat_empresa_id UNIQUE (empresa_id, wa_chat_id)
      );
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS crm_mensajes (
        id          UUID        NOT NULL DEFAULT gen_random_uuid(),
        chat_id     UUID        NOT NULL REFERENCES crm_chats(id) ON DELETE CASCADE,
        empresa_id  UUID        NOT NULL,
        wa_msg_id   VARCHAR(100) NULL,
        direction   VARCHAR(10) NOT NULL,
        agente      VARCHAR(120) NULL,
        body        TEXT        NOT NULL,
        media_url   TEXT        NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_crm_mensajes   PRIMARY KEY (id),
        CONSTRAINT ck_crm_direction  CHECK (direction IN ('INBOUND','OUTBOUND'))
      );
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_chats_empresa   ON crm_chats(empresa_id);
      CREATE INDEX IF NOT EXISTS idx_crm_mensajes_chat   ON crm_mensajes(chat_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_crm_mensajes_empresa ON crm_mensajes(empresa_id);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS crm_mensajes;`);
    await qr.query(`DROP TABLE IF EXISTS crm_chats;`);
  }
}
