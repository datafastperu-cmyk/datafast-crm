import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2 — segundo renombrado real (clasificación aprobada,
 * E-0.2-clasificacion-contrato-id.md v2). `ordenes_trabajo.contrato_id` apunta hoy a
 * `servicios`, no a `contratos` — mismo origen que `comandos_red_pendientes` (censo
 * E-0.2 §3.1: FK creada antes de la fase 3a, nunca redirigida).
 *
 * `ordenes_trabajo` es TÉCNICA por su propio comentario de tabla ("instalaciones,
 * mantenimientos y reparaciones"): siempre sobre una conexión física concreta, nunca
 * sobre el acuerdo comercial. Verificado sin categoría de facturación en su tipo
 * (a diferencia de `tickets`, que sí la tiene y por eso queda excluida de este lote).
 *
 * Sin código de aplicación que tocar: ningún servicio, entidad ni consulta del backend
 * lee o escribe esta tabla hoy (confirmado por búsqueda exhaustiva) — solo la migración
 * que la crea y un `DELETE FROM ordenes_trabajo WHERE cliente_id = $1` en la baja dura de
 * clientes (`clientes.service.ts`), que no toca `contrato_id`.
 *
 * Ningún índice lleva "contrato" en su propio nombre (`idx_ot_empresa`, `idx_ot_tecnico`,
 * `idx_ot_cliente`, `idx_ot_estado_fecha`, `uq_ordenes_empresa_numero`) — no hace falta
 * renombrar ninguno.
 */
export class OrdenesTrabajoApuntaAlServicio1791800000059 implements MigrationInterface {
  name = 'OrdenesTrabajoApuntaAlServicio1791800000059';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ordenes_trabajo RENAME COLUMN contrato_id TO servicio_id`);

    await q.query(`
      COMMENT ON COLUMN ordenes_trabajo.servicio_id IS
        'El Servicio Contratado (tabla servicios) sobre el que se ejecuta el trabajo -- '
        'nunca el acuerdo. Se llamaba contrato_id, heredado del nombre de la tabla antes '
        'de la fase 3a (2026-08-09).'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ordenes_trabajo RENAME COLUMN servicio_id TO contrato_id`);
  }
}
