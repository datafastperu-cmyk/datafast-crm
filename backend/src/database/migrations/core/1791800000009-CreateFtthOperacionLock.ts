import { MigrationInterface, QueryRunner } from 'typeorm';

// Lock de exclusión mutua por CONTRATO para las operaciones FTTH (provisión /
// desaprovisión / cancelación). Causa raíz 2026-07-21 (CNT-2026-000004): una
// desaprovisión y una provisión en vuelo a la vez sobre el mismo contrato dejaron
// un ONT huérfano en la OLT. El lock por registro (`locked_at`) no cubre el caso
// porque el registro puede desaparecer a mitad de la operación → tabla propia,
// indexada por contrato, con TTL para que un proceso caído no bloquee para siempre.
export class CreateFtthOperacionLock1791800000009 implements MigrationInterface {
  name = 'CreateFtthOperacionLock1791800000009';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS ftth_operacion_lock (
        contrato_id  uuid        PRIMARY KEY,
        operacion    varchar(24) NOT NULL,
        token        uuid        NOT NULL,
        adquirido_en timestamptz NOT NULL DEFAULT NOW(),
        expira_en    timestamptz NOT NULL
      )
    `);
    // Barrido de locks expirados (diagnóstico/limpieza); la exclusión no depende
    // de este índice, pero evita seq-scans si la tabla acumula filas muertas.
    await qr.query(
      `CREATE INDEX IF NOT EXISTS idx_ftth_oplock_expira ON ftth_operacion_lock (expira_en)`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS ftth_operacion_lock`);
  }
}
