import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 1 de la directriz de wizards: el procedimiento operativo pasa a ser entidad de
// primera clase. Hasta ahora el ERP no tenía forma de saber "hay un procedimiento en curso,
// con dueño, que aún no fue confirmado", y por eso cada wizard improvisaba su limpieza.
//
// Dos relojes distintos, a propósito:
//   · `expira_en` — lo RENUEVA el heartbeat del navegador. Mientras esté vigente, los
//     barridos no tocan los recursos de esta operación (el operador está a cargo: puede
//     estar leyendo un error 15 minutos sin que un cron le deshaga el trabajo por debajo).
//   · `techo_en`  — se fija al abrir y NO se renueva NUNCA. Es el tope absoluto: pasado ese
//     punto el barrido procede aunque el heartbeat siga latiendo. Sin él, una pestaña
//     olvidada en una laptop encendida bloquearía el recurso para siempre.
export class CreateOperacionWizard1791800000010 implements MigrationInterface {
  name = 'CreateOperacionWizard1791800000010';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS operacion_wizard (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   uuid        NOT NULL,
        usuario_id   uuid        NULL,
        tipo         varchar(48) NOT NULL,
        recurso_ref  varchar(64) NOT NULL,
        estado       varchar(24) NOT NULL DEFAULT 'en_curso',
        heartbeat_at timestamptz NOT NULL DEFAULT NOW(),
        expira_en    timestamptz NOT NULL,
        techo_en     timestamptz NOT NULL,
        cerrado_en   timestamptz NULL,
        motivo_cierre text       NULL,
        created_at   timestamptz NOT NULL DEFAULT NOW(),
        updated_at   timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    // Consulta caliente: "¿hay un wizard VIVO sobre este recurso?" — la ejecutan los barridos
    // en cada ciclo, por eso va indexada por (recurso_ref, estado).
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_operacion_wizard_recurso
        ON operacion_wizard (recurso_ref, estado)
    `);
    // Barrido de vencidos sin confirmar.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_operacion_wizard_expira
        ON operacion_wizard (estado, expira_en)
    `);
    // Un recurso no puede tener dos procedimientos abiertos a la vez. Índice PARCIAL: solo
    // aplica a los 'en_curso', así el histórico de operaciones cerradas se conserva completo.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_operacion_wizard_recurso_en_curso
        ON operacion_wizard (recurso_ref) WHERE estado = 'en_curso'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS operacion_wizard`);
  }
}
