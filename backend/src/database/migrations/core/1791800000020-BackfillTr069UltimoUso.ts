import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill de `tr069_ultimo_uso_at` en los carriles TR-069 activos.
 *
 * El barrido de TTL dejó de aceptar `COALESCE(tr069_ultimo_uso_at, updated_at)`: `updated_at`
 * lo toca cualquier proceso ajeno al TR-069 (drift-watcher, refresh de inventario), así que
 * medía "actividad de la tabla", no uso del carril — un carril sin un solo uso real podía no
 * vencer nunca. Ahora el barrido exige la columna propia.
 *
 * Las filas creadas antes de la Fase 2 pueden tenerla en NULL. Sin este backfill el barrido
 * las excluye para siempre (a propósito: no desactiva por un dato ausente) y quedarían
 * consumiendo capacidad del ACS de forma indefinida. Se les siembra `updated_at` UNA sola vez
 * —aquí, con criterio explícito y auditable— en lugar de dejar la aproximación escondida
 * dentro del query que corre cada día.
 *
 * Solo toca carriles `activo` con la marca ausente: no reescribe ninguna marca real.
 */
export class BackfillTr069UltimoUso1791800000020 implements MigrationInterface {
  name = 'BackfillTr069UltimoUso1791800000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE ftth_onu_registro
      SET tr069_ultimo_uso_at = updated_at
      WHERE carril_estado = 'activo'
        AND tr069_ultimo_uso_at IS NULL
        AND deleted_at IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Irreversible por diseño: revertir significaría borrar marcas de uso que desde el
    // backfill pudieron actualizarse con usos reales. No hay nada que restaurar.
  }
}
