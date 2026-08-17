import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2 — cuarto renombrado real (clasificación aprobada,
 * E-0.2-clasificacion-contrato-id.md v2). `ips_asignadas.contrato_id` apunta hoy a
 * `servicios` — mismo origen que las tablas ya renombradas (censo E-0.2 §3.1).
 *
 * TÉCNICA sin ambigüedad: la asignación de una IP a UNA conexión ("eventos de red" del
 * criterio del propietario). `tipo = 'infraestructura'` ya deja `contrato_id` (ahora
 * `servicio_id`) en NULL de forma natural (columna nullable) — no hay caso mixto.
 *
 * Ningún índice de la tabla lleva "contrato" en su propio nombre.
 */
export class IpsAsignadasApuntaAlServicio1791800000061 implements MigrationInterface {
  name = 'IpsAsignadasApuntaAlServicio1791800000061';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ips_asignadas RENAME COLUMN contrato_id TO servicio_id`);

    await q.query(`
      COMMENT ON COLUMN ips_asignadas.servicio_id IS
        'El Servicio Contratado (tabla servicios) al que está asignada esta IP -- NULL si '
        'es infraestructura. Nunca el acuerdo. Se llamaba contrato_id, heredado del '
        'nombre de la tabla antes de la fase 3a (2026-08-09).'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ips_asignadas RENAME COLUMN servicio_id TO contrato_id`);
  }
}
