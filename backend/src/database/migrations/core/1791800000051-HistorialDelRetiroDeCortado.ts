import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige un defecto de `TresEstadosYOrigen1791800000050`, de la misma tarde.
 *
 * Aquella migración pasaba los contratos `cortado` a `suspendido` y después insertaba la fila de
 * historial que explica el salto. Pero identificaba a esos contratos por su `motivo_estado`, que
 * había escrito ella misma con un `COALESCE(NULLIF(motivo_estado, ''), 'Corte por prórroga
 * incumplida')` — es decir, **solo lo escribía si el motivo estaba vacío**.
 *
 * En producción no lo estaba: el único contrato afectado tenía «Reactivación de cliente». La
 * condición del INSERT no se cumplió, el contrato cambió de estado y **el historial no lo
 * registró**. Queda un contrato cuya última fila de historial dice `cortado` y cuya tabla dice
 * `suspendido`: exactamente el salto inexplicable que la fila pretendía evitar.
 *
 * La condición correcta no mira el motivo —que es texto libre y puede ser cualquier cosa— sino el
 * hecho: **el contrato está suspendido y su última transición registrada terminó en `cortado`**.
 * Es idempotente por construcción: en cuanto la fila existe, deja de cumplirse.
 */
export class HistorialDelRetiroDeCortado1791800000051 implements MigrationInterface {
  name = 'HistorialDelRetiroDeCortado1791800000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH ultima AS (
        SELECT DISTINCT ON (contrato_id) contrato_id, estado_nuevo
          FROM contratos_historial
         ORDER BY contrato_id, created_at DESC, id DESC
      )
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, automatico, origen)
      SELECT c.id, c.empresa_id, 'cortado', 'suspendido',
             'Retirada del estado cortado — la causa pasa al historial (fase 1, tres estados)',
             TRUE, 'prorroga_incumplida'
        FROM contratos c
        JOIN ultima u ON u.contrato_id = c.id
       WHERE c.estado = 'suspendido'
         AND u.estado_nuevo = 'cortado'
    `);
  }

  public async down(): Promise<void> {
    // Nada que deshacer: borrar filas de historial sería perder la única constancia de que el
    // cambio de estado ocurrió, que es justo lo que esta migración existe para arreglar.
  }
}
