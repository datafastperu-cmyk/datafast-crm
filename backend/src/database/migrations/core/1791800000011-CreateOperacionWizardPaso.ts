import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 2 de la directriz de wizards: BITÁCORA DE COMPENSACIÓN (patrón saga).
//
// El rollback deja de ser código disperso y pasa a ser DATO: cada paso mutante registra,
// en el momento de ejecutarse, cómo deshacerse y cómo verificar si llegó a aplicarse.
// Anular = reproducir las compensaciones en orden inverso (LIFO), cada una verificada.
//
// WRITE-AHEAD (regla crítica): el paso se escribe como `en_vuelo` ANTES de tocar el
// hardware, nunca después. Si el proceso muere entre "ejecuté `ont add`" y "escribí el
// paso", sin write-ahead el huérfano renace — que es exactamente el defecto 4 que
// arrastraba FtthRecoveryCron. Un paso que queda `en_vuelo` es SOSPECHOSO de haberse
// ejecutado: antes de decidir si hay algo que compensar se comprueba contra el hardware
// con la sonda guardada en `verificacion`.
export class CreateOperacionWizardPaso1791800000011 implements MigrationInterface {
  name = 'CreateOperacionWizardPaso1791800000011';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS operacion_wizard_paso (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        operacion_id uuid        NOT NULL REFERENCES operacion_wizard(id) ON DELETE CASCADE,
        orden        int         NOT NULL,
        tipo         varchar(48) NOT NULL,
        descripcion  text        NOT NULL,
        -- Cómo deshacer el paso (payload interpretado por el compensador según 'tipo').
        compensacion jsonb       NOT NULL,
        -- Cómo saber si el paso llegó a aplicarse. Sin esta sonda, un paso 'en_vuelo'
        -- no es resoluble: no sabríamos si hay algo que compensar o no.
        verificacion jsonb       NULL,
        -- en_vuelo → aplicado | no_aplicado → compensado | compensacion_fallida
        estado       varchar(24) NOT NULL DEFAULT 'en_vuelo',
        error        text        NULL,
        created_at   timestamptz NOT NULL DEFAULT NOW(),
        updated_at   timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    // La compensación recorre los pasos de una operación en orden inverso.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_owp_operacion_orden
        ON operacion_wizard_paso (operacion_id, orden DESC)
    `);
    // Barrido de pasos que quedaron colgados en vuelo.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_owp_estado
        ON operacion_wizard_paso (estado)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS operacion_wizard_paso`);
  }
}
