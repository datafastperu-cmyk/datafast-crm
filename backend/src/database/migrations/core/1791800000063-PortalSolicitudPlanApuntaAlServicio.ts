import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2 — sexto renombrado real (clasificación aprobada,
 * E-0.2-clasificacion-contrato-id.md v2, corrección del propietario).
 * `portal_solicitud_plan.contrato_id` apunta hoy a `servicios` — mismo origen que las
 * tablas ya renombradas (censo E-0.2 §3.1).
 *
 * TÉCNICA: el plan vive en el Servicio Contratado (E02-11/D-3), no en el acuerdo. Una
 * solicitud de cambio de plan es sobre la conexión que el abonado tiene hoy, no sobre el
 * contrato que la agrupa.
 *
 * Ningún índice de la tabla lleva "contrato" en su propio nombre
 * (`ux_portal_solicitud_plan_pendiente`, `idx_portal_solicitud_plan_bandeja`) — Postgres
 * actualiza solo la referencia de columna interna de `ux_portal_solicitud_plan_pendiente`,
 * no hace falta ALTER INDEX.
 */
export class PortalSolicitudPlanApuntaAlServicio1791800000063 implements MigrationInterface {
  name = 'PortalSolicitudPlanApuntaAlServicio1791800000063';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE portal_solicitud_plan RENAME COLUMN contrato_id TO servicio_id`);

    await q.query(`
      COMMENT ON COLUMN portal_solicitud_plan.servicio_id IS
        'El Servicio Contratado (tabla servicios) sobre el que se pide el cambio de plan. '
        'Nunca el acuerdo. Se llamaba contrato_id, heredado del nombre de la tabla antes '
        'de la fase 3a (2026-08-09).'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE portal_solicitud_plan RENAME COLUMN servicio_id TO contrato_id`);
  }
}
