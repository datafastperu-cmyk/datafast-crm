import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { DataSource }                             from 'typeorm';

// ─────────────────────────────────────────────────────────────
// OltAtomicLockService
//
// Exclusión mutua a nivel de ONU usando PostgreSQL advisory locks.
//
// DISEÑO DE CONCURRENCIA:
//   - pg_try_advisory_lock es NO-BLOQUEANTE: retorna false en vez
//     de esperar si el lock ya está tomado.
//   - Los advisory locks son NIVEL-SESIÓN (por conexión), no por
//     transacción. Por eso se usa un QueryRunner dedicado que
//     mantiene la misma conexión física durante toda la operación.
//   - pg_try_advisory_lock(int4, int4) usa dos claves de 32 bits:
//       · arg1 = hashtext(oltId)  — namespace de la OLT
//       · arg2 = hashtext(onuSn)  — identidad de la ONU
//     Espacio de claves 2^64 — colisiones prácticamente imposibles
//     para el universo de ONUs de un ISP.
//
// PEOR ESCENARIO CUBIERTO:
//   - fn() lanza: el finally garantiza pg_advisory_unlock y
//     release del QueryRunner pase lo que pase.
//   - Lock ya tomado: ConflictException inmediata, sin retry ni
//     espera — el Router/Service decide si reintentar con backoff.
//   - Crash del proceso: PG libera automáticamente los advisory
//     locks de la sesión al cerrar la conexión.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltAtomicLockService {
  private readonly logger = new Logger(OltAtomicLockService.name);

  constructor(private readonly dataSource: DataSource) {}

  // ── Ejecución con lock exclusivo por (oltId, onuSn) ─────────

  async withLock<T>(
    oltId:  string,
    onuSn:  string,
    fn:     () => Promise<T>,
  ): Promise<T> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();   // obtiene una conexión física dedicada del pool

    try {
      // Intentar adquirir el lock — no bloquea si ya está tomado
      const rows = await qr.query(
        `SELECT pg_try_advisory_lock(hashtext($1)::integer, hashtext($2)::integer) AS acquired`,
        [oltId, onuSn],
      ) as Array<{ acquired: boolean }>;
      const row = rows[0];

      if (!row.acquired) {
        throw new ConflictException(
          `ONU ${onuSn} en OLT ${oltId} ya tiene una operación en curso — reintente en unos segundos`,
        );
      }

      this.logger.debug(`Lock adquirido | OLT=${oltId} SN=${onuSn}`);

      try {
        return await fn();
      } finally {
        // Liberar en la MISMA conexión — obligatorio para session-level locks
        await qr.query(
          `SELECT pg_advisory_unlock(hashtext($1)::integer, hashtext($2)::integer)`,
          [oltId, onuSn],
        );
        this.logger.debug(`Lock liberado | OLT=${oltId} SN=${onuSn}`);
      }

    } finally {
      await qr.release();   // devuelve la conexión al pool
    }
  }

  // ── Comprobación de estado sin adquirir ──────────────────────
  // Útil para diagnóstico — no usar para tomar decisiones de negocio
  // (race condition entre check y uso).

  async isLocked(oltId: string, onuSn: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory'
           AND classid   = hashtext($1)::integer
           AND objid     = hashtext($2)::integer
           AND granted   = true
       ) AS locked`,
      [oltId, onuSn],
    ) as Array<{ locked: boolean }>;
    return rows[0].locked;
  }
}
