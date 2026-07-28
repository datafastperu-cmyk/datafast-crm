import { MigrationInterface, QueryRunner } from 'typeorm';

// Un router activo por IP de gestión y empresa. Mismo patrón —y misma causa— que el
// índice equivalente de `olts` (Incremento 7): sin él, cada re-registro del mismo equipo
// crea otra fila y el ERP termina poleando N veces el mismo dispositivo.
//
// Estado encontrado en producción el 2026-07-28: 11 registros para 5 IPs — 10.8.1.2
// duplicado ×5 y 10.8.1.3 ×3, todos `activo` y con 0 contratos. El poller intentaba
// conectar cada 5 min a routers de prueba que ya no existen, llenando los logs de
// `RosException: Timed out after 8 seconds`.
export class UniqueRouterIpActivo1791800000016 implements MigrationInterface {
  name = 'UniqueRouterIpActivo1791800000016';

  public async up(qr: QueryRunner): Promise<void> {
    // 1) Desactivar duplicados y routers sin uso ANTES de crear el índice: con ellos
    //    activos, la creación fallaría. Regla determinista y conservadora:
    //    se CONSERVA activo el registro con contratos vigentes; si ninguno los tiene,
    //    el más antiguo (el original; los demás son re-registros). Nada se borra —
    //    `activo = false` es reversible y no toca los certs VPN.
    await qr.query(`
      WITH ranked AS (
        SELECT r.id,
               ROW_NUMBER() OVER (
                 PARTITION BY r.empresa_id, r.ip_gestion
                 ORDER BY (SELECT count(*) FROM contratos c
                           WHERE c.router_id = r.id AND c.deleted_at IS NULL) DESC,
                          r.created_at ASC
               ) AS pos
        FROM routers r
        WHERE r.activo = true
      )
      UPDATE routers SET activo = false
      WHERE id IN (SELECT id FROM ranked WHERE pos > 1)
    `);

    // 2) Ya sin duplicados activos, el invariante queda garantizado por el motor.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_routers_ip_activo
        ON routers (empresa_id, ip_gestion)
        WHERE activo = true
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Solo se retira el índice. Los routers desactivados NO se reactivan: hacerlo
    // recrearía los duplicados que motivaron esta migración, y reactivar el correcto
    // es una decisión de operación, no de un rollback automático.
    await qr.query(`DROP INDEX IF EXISTS idx_routers_ip_activo`);
  }
}
