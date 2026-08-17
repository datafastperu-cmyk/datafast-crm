import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2, entregable 3 — primer renombrado real de `contrato_id` (clasificación aprobada:
 * `E-0.2-clasificacion-contrato-id.md`).
 *
 * `comandos_red_pendientes.contrato_id` apunta hoy a `servicios`, no a `contratos` — igual
 * que `facturas.contrato_id` antes de la fase 4.1 (censo `E-0.2-censo-contrato-id.md` §3.1,
 * §3.4: es el caso ancla, `outbox-red.service.ts` consultando `servicios` con este valor).
 * El outbox es una capacidad TÉCNICA (E02-03/E02-09: el sujeto de una operación contra
 * mikrotik/OLT es el Servicio Contratado, nunca el acuerdo) — el nombre pasa a decir lo
 * que la columna siempre guardó.
 *
 * Ninguna FK cambia de tabla física (segue apuntando al mismo OID, la de `servicios`,
 * heredado de la fase 3a). Esto es solo el nombre alcanzando la realidad — no hay
 * traducción de valores como en el lote de dinero que viene después.
 *
 * Ningún índice de esta tabla lleva "contrato" en su propio nombre (a diferencia de la
 * fase 3b, que sí tuvo que renombrar índices) — verificado contra el esquema vivo antes de
 * escribir esta migración: `idx_cmdr_pendiente`, `idx_cmdr_dedup_activo`,
 * `idx_cmdr_claim_expirado`, `idx_cmdr_pendiente_orden`. Postgres actualiza la definición
 * del índice al renombrar la columna referenciada; no hace falta tocarlos.
 */
export class OutboxRedApuntaAlServicio1791800000058 implements MigrationInterface {
  name = 'OutboxRedApuntaAlServicio1791800000058';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE comandos_red_pendientes RENAME COLUMN contrato_id TO servicio_id`);

    await q.query(`
      COMMENT ON COLUMN comandos_red_pendientes.servicio_id IS
        'El Servicio Contratado (tabla servicios) contra el que se ejecuta el comando -- '
        'nunca el acuerdo. Se llamaba contrato_id, heredado del nombre de la tabla antes de '
        'la fase 3a (2026-08-09).'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE comandos_red_pendientes RENAME COLUMN servicio_id TO contrato_id`);
  }
}
