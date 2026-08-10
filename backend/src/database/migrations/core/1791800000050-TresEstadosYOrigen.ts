import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 1 del plan de implementación del core (§10 de `catalogo-servicios-notas.md`).
 *
 * **Tres estados para todo**, decidido por el propietario el 2026-08-09: `activo`, `suspendido` y
 * `baja_definitiva`. `cortado` se retira.
 *
 * El motivo es que `cortado` no describía un estado distinto del servicio —el abonado está sin
 * servicio en los dos— sino **por qué** se llegó a él: había roto una prórroga. Eso no es un
 * estado, es la causa de una transición, y su sitio es el historial. Mientras vivió como estado
 * partía en dos todas las consultas que preguntan «¿tiene servicio?», y cada autor tenía que
 * acordarse de escribir `IN ('suspendido', 'cortado')` — con el resultado previsible de que
 * algunas lo hacían y otras no.
 *
 * A cambio, `contratos_historial.origen` responde la pregunta para TODAS las suspensiones, no solo
 * para la de la prórroga: hacía falta igualmente para el barrido de retiro de equipos, que
 * necesita distinguir una baja voluntaria de un corte por mora.
 *
 * **El valor `cortado` NO se borra del enum de PostgreSQL.** Es irreversible y no aporta nada:
 * basta con que nadie lo escriba, y una barrera lo sostiene. Mismo criterio que con `moroso`
 * (2026-08-08).
 */
export class TresEstadosYOrigen1791800000050 implements MigrationInterface {
  name = 'TresEstadosYOrigen1791800000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. El origen de cada transición ──────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE origen_transicion AS ENUM
          ('mora', 'voluntaria', 'prorroga_incumplida', 'administrativa');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE contratos_historial
        ADD COLUMN IF NOT EXISTS origen origen_transicion
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN contratos_historial.origen IS
        'Por qué ocurrió la transición. Nulo en las filas anteriores a 2026-08-09: no se puede '
        'inferir sin adivinar, y una etiqueta inventada sería peor que la ausencia.'
    `);

    // Solo se rellena hacia atrás lo que el propio texto declara sin ambigüedad. El resto queda
    // en NULL a propósito: deducir el origen del resto del historial sería inventarlo, y estas
    // filas alimentan decisiones de negocio (el barrido de retiro de equipos).
    await queryRunner.query(`
      UPDATE contratos_historial
         SET origen = 'prorroga_incumplida'
       WHERE origen IS NULL
         AND estado_nuevo = 'cortado'
    `);

    // ── 2. Los contratos cortados pasan a suspendidos ────────────────────────
    // El estado se pierde, así que el motivo tiene que conservar la causa: es la única copia
    // que queda de por qué ese abonado está sin servicio.
    await queryRunner.query(`
      UPDATE contratos
         SET estado        = 'suspendido',
             motivo_estado = COALESCE(NULLIF(motivo_estado, ''), 'Corte por prórroga incumplida'),
             updated_at    = NOW()
       WHERE estado = 'cortado'
    `);

    // La transición queda escrita: sin esto, el historial de esos contratos daría un salto
    // inexplicable entre 'cortado' y su siguiente estado.
    await queryRunner.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, automatico, origen)
      SELECT c.id, c.empresa_id, 'cortado', 'suspendido',
             'Retirada del estado cortado — la causa pasa al historial (fase 1, tres estados)',
             TRUE, 'prorroga_incumplida'
        FROM contratos c
       WHERE c.motivo_estado = 'Corte por prórroga incumplida'
         AND c.estado = 'suspendido'
         AND NOT EXISTS (
           SELECT 1 FROM contratos_historial h
            WHERE h.contrato_id = c.id AND h.estado_anterior = 'cortado'
              AND h.estado_nuevo = 'suspendido'
         )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No se revierte el estado de los contratos: `cortado` y `suspendido` significan lo mismo
    // para el servicio, y devolver filas a un estado retirado dejaría el sistema en un punto
    // que el código ya no sabe leer. La columna sí se puede quitar.
    await queryRunner.query(`ALTER TABLE contratos_historial DROP COLUMN IF EXISTS origen`);
    await queryRunner.query(`DROP TYPE IF EXISTS origen_transicion`);
  }
}
