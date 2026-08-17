import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2 — tercer renombrado real (clasificación aprobada,
 * E-0.2-clasificacion-contrato-id.md v2). `consumo_datos.contrato_id` y
 * `consumo_snapshot.contrato_id` apuntan hoy a `servicios` — mismo origen que
 * `comandos_red_pendientes`/`ordenes_trabajo` (censo E-0.2 §3.1).
 *
 * DOS tablas en la MISMA migración, excepción justificada a "una tabla por commit": están
 * físicamente acopladas en un solo fichero de aplicación
 * (`portal/consumo-colector.service.ts`) que las lee y escribe SIEMPRE juntas —
 * `consumo_snapshot` es la última lectura del contador (para calcular el delta),
 * `consumo_datos` es el consumo acumulado que resulta de ese delta. Partirlas en dos
 * commits dejaría el mismo fichero, la misma función, con una tabla renombrada y la otra
 * no — exactamente el "renombrado a medias" que el censo advierte como más peligroso que
 * no renombrar nada.
 *
 * Ambas TÉCNICAS sin ambigüedad: métricas de tráfico de una conexión concreta
 * (rx_bytes/tx_bytes), el ejemplo literal que nombra el criterio del propietario.
 *
 * Índice a renombrar: `idx_consumo_contrato_fecha` en `consumo_datos` (el único de las dos
 * tablas cuyo NOMBRE propio dice "contrato" — `idx_consumo_snapshot_empresa`,
 * `idx_consumo_cliente_fecha`, `idx_consumo_empresa_fecha` e `idx_consumo_diario` no lo
 * llevan y no necesitan tocarse).
 */
export class ConsumoApuntaAlServicio1791800000060 implements MigrationInterface {
  name = 'ConsumoApuntaAlServicio1791800000060';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE consumo_datos     RENAME COLUMN contrato_id TO servicio_id`);
    await q.query(`ALTER TABLE consumo_snapshot   RENAME COLUMN contrato_id TO servicio_id`);

    await q.query(`ALTER INDEX idx_consumo_contrato_fecha RENAME TO idx_consumo_servicio_fecha`);

    await q.query(`
      COMMENT ON COLUMN consumo_datos.servicio_id IS
        'El Servicio Contratado (tabla servicios) que generó el tráfico -- nunca el '
        'acuerdo. Se llamaba contrato_id, heredado del nombre de la tabla antes de la '
        'fase 3a (2026-08-09).'
    `);
    await q.query(`
      COMMENT ON COLUMN consumo_snapshot.servicio_id IS
        'El Servicio Contratado (tabla servicios) cuyo contador se leyó -- nunca el '
        'acuerdo. Se llamaba contrato_id, heredado del nombre de la tabla antes de la '
        'fase 3a (2026-08-09).'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER INDEX idx_consumo_servicio_fecha RENAME TO idx_consumo_contrato_fecha`);
    await q.query(`ALTER TABLE consumo_snapshot   RENAME COLUMN servicio_id TO contrato_id`);
    await q.query(`ALTER TABLE consumo_datos     RENAME COLUMN servicio_id TO contrato_id`);
  }
}
