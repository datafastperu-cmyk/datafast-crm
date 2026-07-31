import { MigrationInterface, QueryRunner } from 'typeorm';

// Registro write-ahead del envío del CRM WhatsApp.
//
// El envío hacía: sendMessage() contra WhatsApp y DESPUÉS guardaba la fila. Si el
// guardado fallaba —o el proceso moría entre ambos pasos— el mensaje ya había
// salido al cliente y en el ERP no quedaba rastro: el operador lo daba por no
// enviado y lo repetía. Es el mismo patrón que la regla de sagas del proyecto
// prohíbe: registrar el paso ANTES de ejecutarlo, nunca después.
//
// `estado_envio` distingue además el caso que un timeout deja abierto: contra
// hardware o servicios externos, "no respondió a tiempo" NO significa "no pasó
// nada", así que existe un estado explícito para "pudo haberse enviado" en vez de
// reportar un fallo que quizá no lo fue.
export class CrmMensajesEstadoEnvio1791800000027 implements MigrationInterface {
  name = 'CrmMensajesEstadoEnvio1791800000027';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE crm_mensajes
        ADD COLUMN IF NOT EXISTS estado_envio VARCHAR(14) NOT NULL DEFAULT 'confirmado',
        ADD COLUMN IF NOT EXISTS error_envio  TEXT
    `);

    await qr.query(`
      ALTER TABLE crm_mensajes
        DROP CONSTRAINT IF EXISTS ck_crm_estado_envio
    `);
    await qr.query(`
      ALTER TABLE crm_mensajes
        ADD CONSTRAINT ck_crm_estado_envio CHECK (
          estado_envio IN ('en_vuelo', 'confirmado', 'indeterminado', 'fallido')
        )
    `);

    // Los mensajes recibidos y los ya enviados antes de este cambio son hechos
    // consumados: nacen confirmados.
    await qr.query(`UPDATE crm_mensajes SET estado_envio = 'confirmado' WHERE estado_envio IS NULL`);

    // Para el barrido de envíos que quedaron en vuelo.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_mensajes_en_vuelo
        ON crm_mensajes (created_at)
        WHERE estado_envio = 'en_vuelo'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_crm_mensajes_en_vuelo`);
    await qr.query(`ALTER TABLE crm_mensajes DROP CONSTRAINT IF EXISTS ck_crm_estado_envio`);
    await qr.query(`ALTER TABLE crm_mensajes DROP COLUMN IF EXISTS error_envio`);
    await qr.query(`ALTER TABLE crm_mensajes DROP COLUMN IF EXISTS estado_envio`);
  }
}
