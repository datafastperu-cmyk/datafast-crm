import { MigrationInterface, QueryRunner } from 'typeorm';

// Reclamo atómico del outbox de red (causa raíz 2026-07-28). El barrido tomaba los
// comandos con `SELECT ... FOR UPDATE SKIP LOCKED` dentro de una transacción que se
// cerraba ANTES de ejecutar contra el hardware: al soltarse el lock de fila, el otro
// proceso PM2 tomaba el mismo comando. Observado en producción — api-core y
// worker-auxiliary procesaron el id=26 en el mismo tick (02:30:00); en FTTH lo frenó
// el FtthOperacionLockService con un 409, pero la rama MikroTik no tiene lock
// equivalente y podía aplicar el mismo SUSPENDER dos veces contra el mismo router.
//
// El estado EN_PROCESO con dueño y TTL hace del reclamo un hecho persistido, no una
// propiedad efímera de la transacción. `claim_expira_en` cubre el proceso que muere a
// mitad: el barrido devuelve el comando a PENDIENTE (los comandos son idempotentes).
export class AddClaimAtomicoOutboxRed1791800000015 implements MigrationInterface {
  name = 'AddClaimAtomicoOutboxRed1791800000015';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE comandos_red_pendientes
        ADD COLUMN IF NOT EXISTS reclamado_por   VARCHAR(80),
        ADD COLUMN IF NOT EXISTS reclamado_en    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS claim_expira_en TIMESTAMPTZ
    `);

    // Barrido de claims huérfanos (proceso muerto con el comando reclamado).
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_cmdr_claim_expirado
        ON comandos_red_pendientes (claim_expira_en)
        WHERE estado = 'EN_PROCESO'
    `);

    // La deduplicación debe cubrir también EN_PROCESO. Con el índice anterior
    // (solo PENDIENTE) un comando reclamado dejaba de bloquear el INSERT del
    // mismo (contrato, accion) → se encolaba un duplicado mientras el original
    // estaba en vuelo contra el hardware, que es justo lo que veníamos de cerrar.
    await qr.query(`DROP INDEX IF EXISTS idx_cmdr_dedup_pendiente`);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdr_dedup_activo
        ON comandos_red_pendientes (contrato_id, accion)
        WHERE estado IN ('PENDIENTE', 'EN_PROCESO')
    `);

    // El barrido de pendientes filtra por estado = 'PENDIENTE'; mantenerlo alineado.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_cmdr_pendiente_orden
        ON comandos_red_pendientes (creado_en)
        WHERE estado = 'PENDIENTE'
    `);

    // Cualquier comando que hubiera quedado a medias antes de este despliegue
    // sigue siendo PENDIENTE: no hay estado EN_PROCESO previo que migrar.
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Devolver a PENDIENTE lo reclamado antes de retirar el mecanismo: si no, esos
    // comandos quedarían en un estado que el código anterior no sabe procesar.
    await qr.query(`
      UPDATE comandos_red_pendientes
      SET estado = 'PENDIENTE'
      WHERE estado = 'EN_PROCESO'
    `);
    await qr.query(`DROP INDEX IF EXISTS idx_cmdr_pendiente_orden`);
    await qr.query(`DROP INDEX IF EXISTS idx_cmdr_dedup_activo`);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdr_dedup_pendiente
        ON comandos_red_pendientes (contrato_id, accion)
        WHERE estado = 'PENDIENTE'
    `);
    await qr.query(`DROP INDEX IF EXISTS idx_cmdr_claim_expirado`);
    await qr.query(`
      ALTER TABLE comandos_red_pendientes
        DROP COLUMN IF EXISTS reclamado_por,
        DROP COLUMN IF EXISTS reclamado_en,
        DROP COLUMN IF EXISTS claim_expira_en
    `);
  }
}
