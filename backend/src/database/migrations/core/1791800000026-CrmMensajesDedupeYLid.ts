import { MigrationInterface, QueryRunner } from 'typeorm';

// Integridad del CRM WhatsApp. Dos garantías que el código decía tener y el
// esquema no sostenía (auditoría 30-31/07/2026):
//
// 1. DEDUPLICACIÓN DE MENSAJES. `guardarMensaje` se protegía consultando antes
//    por `wa_msg_id` y decidiendo en JavaScript si insertar. Entre esa consulta
//    y el INSERT no hay nada: dos eventos del mismo mensaje —el eco de un envío
//    propio y el `message_create` correspondiente— insertan las dos filas. Sin
//    índice único no existe forma de que el ON CONFLICT del servicio funcione.
//    Parcial porque el historial importado puede no traer id: esas filas no
//    compiten entre sí.
//
// 2. IDENTIFICADORES LID. Meta migró cuentas de WhatsApp Business al esquema LID
//    y el chat pasa a ser `<lid>@lid`, un identificador interno de 15 dígitos que
//    NO es un teléfono. El código lo guardaba igual en `telefono`: 11 de los 21
//    chats de la primera vinculación real quedaron con un LID donde debía haber
//    un número, imposibles de cruzar con la ficha del cliente. La bandera separa
//    "este es el número del abonado" de "esto es un identificador opaco", que es
//    lo que el resto del ERP necesita saber antes de intentar el cruce.
export class CrmMensajesDedupeYLid1791800000026 implements MigrationInterface {
  name = 'CrmMensajesDedupeYLid1791800000026';

  public async up(qr: QueryRunner): Promise<void> {
    // Los duplicados que ya existan impiden crear el índice: se conserva el más
    // antiguo de cada wa_msg_id, que es el que el operador ya vio en pantalla.
    await qr.query(`
      DELETE FROM crm_mensajes a
      USING crm_mensajes b
      WHERE a.wa_msg_id IS NOT NULL
        AND a.wa_msg_id = b.wa_msg_id
        AND a.created_at > b.created_at
    `);

    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_mensajes_wa_msg_id
        ON crm_mensajes (wa_msg_id)
        WHERE wa_msg_id IS NOT NULL
    `);

    await qr.query(`
      ALTER TABLE crm_chats
        ADD COLUMN IF NOT EXISTS es_lid BOOLEAN NOT NULL DEFAULT false
    `);

    // Los chats @lid ya existentes: el valor de `telefono` es un LID, no un número.
    await qr.query(`
      UPDATE crm_chats
      SET es_lid = true
      WHERE wa_chat_id LIKE '%@lid'
    `);

    // Listado del CRM: ordena por última actividad dentro de la empresa.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_chats_empresa_actividad
        ON crm_chats (empresa_id, ultimo_msg_at DESC NULLS LAST)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_crm_chats_empresa_actividad`);
    await qr.query(`ALTER TABLE crm_chats DROP COLUMN IF EXISTS es_lid`);
    await qr.query(`DROP INDEX IF EXISTS uq_crm_mensajes_wa_msg_id`);
  }
}
