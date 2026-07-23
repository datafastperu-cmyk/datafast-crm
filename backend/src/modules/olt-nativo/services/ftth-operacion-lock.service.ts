import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

export type OperacionFtth = 'provision' | 'desaprovision' | 'cancelacion' | 'tr069';

const ETIQUETA: Record<OperacionFtth, string> = {
  provision:    'un aprovisionamiento',
  desaprovision: 'una desaprovisión',
  cancelacion:  'una cancelación',
  tr069:        'una operación de gestión TR-069',
};

// ─────────────────────────────────────────────────────────────
// FtthOperacionLockService — exclusión mutua por CONTRATO.
//
// Causa raíz (incidente 2026-07-21, CNT-2026-000004): una desaprovisión y una
// provisión corrieron EN VUELO A LA VEZ sobre el mismo contrato. La provisión
// registró el GPON en la OLT mientras la desaprovisión ya había borrado el
// registro → carril async contra un contrato sin registro → ONT huérfano
// (discordancia físico↔lógico). El lock por registro (`locked_at`) no cubre
// este caso: el registro puede DEJAR DE EXISTIR a mitad de la operación.
// Por eso el lock vive en su propia tabla, indexado por contrato, y sobrevive
// al ciclo de vida del registro.
//
// Cross-proceso a propósito: los watchers/crons corren en
// `datafast-worker-auxiliary` y las acciones de usuario en `datafast-api-core`
// — un mutex en memoria no los excluiría entre sí.
//
// Peor escenario cubierto: el proceso muere con el lock tomado. Se libera solo
// por TTL (`expira_en`), nunca queda un contrato bloqueado para siempre. Las
// operaciones largas renuevan el TTL con `renovar()` (heartbeat).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class FtthOperacionLockService {
  private readonly logger = new Logger(FtthOperacionLockService.name);

  /** TTL por defecto. Una provisión completa ronda los 90-150s; 5 min da margen
   *  sin dejar el contrato bloqueado mucho rato si el proceso muere. */
  private readonly TTL_SEGUNDOS = 300;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Toma el lock del contrato. Lanza ConflictException (409) si otra operación
   * lo tiene tomado y aún no expiró — nunca espera en cola: el operador debe
   * ver de inmediato que hay algo en curso, no quedarse colgado.
   * Devuelve el token del dueño, necesario para liberarlo.
   */
  async adquirir(
    contratoId: string,
    operacion:  OperacionFtth,
    ttlSegundos = this.TTL_SEGUNDOS,
  ): Promise<string> {
    const token = randomUUID();

    // INSERT ... ON CONFLICT DO UPDATE WHERE expirado → atómico: solo un proceso
    // puede ganar. Si el lock vigente es de otro, no se actualiza y no retorna fila.
    const filas = await this.ds.query<{ token: string }[]>(
      `INSERT INTO ftth_operacion_lock (contrato_id, operacion, token, adquirido_en, expira_en)
       VALUES ($1, $2, $3, NOW(), NOW() + ($4 || ' seconds')::interval)
       ON CONFLICT (contrato_id) DO UPDATE
         SET operacion    = EXCLUDED.operacion,
             token        = EXCLUDED.token,
             adquirido_en = NOW(),
             expira_en    = EXCLUDED.expira_en
         WHERE ftth_operacion_lock.expira_en < NOW()
       RETURNING token`,
      [contratoId, operacion, token, String(ttlSegundos)],
    );

    if (filas.length === 0) {
      const [actual] = await this.ds.query<{ operacion: OperacionFtth; expira_en: Date }[]>(
        `SELECT operacion, expira_en FROM ftth_operacion_lock WHERE contrato_id = $1`,
        [contratoId],
      );
      const enCurso = actual ? (ETIQUETA[actual.operacion] ?? actual.operacion) : 'otra operación';
      this.logger.warn(
        `Lock FTTH DENEGADO | contrato=${contratoId} pedida=${operacion} en_curso=${actual?.operacion}`,
      );
      throw new ConflictException(
        `Ya hay ${enCurso} en curso para este contrato. Espera a que termine antes de continuar — ` +
        `ejecutar dos operaciones a la vez sobre la misma ONU deja la OLT y el ERP desincronizados.`,
      );
    }

    this.logger.log(`Lock FTTH tomado | contrato=${contratoId} operacion=${operacion} ttl=${ttlSegundos}s`);
    return token;
  }

  /** Renueva el TTL (heartbeat) mientras la operación sigue viva. No lanza. */
  async renovar(contratoId: string, token: string, ttlSegundos = this.TTL_SEGUNDOS): Promise<void> {
    await this.ds.query(
      `UPDATE ftth_operacion_lock
       SET expira_en = NOW() + ($3 || ' seconds')::interval
       WHERE contrato_id = $1 AND token = $2`,
      [contratoId, token, String(ttlSegundos)],
    ).catch(() => { /* best-effort: el TTL vigente sigue protegiendo */ });
  }

  /**
   * Libera el lock. Solo borra si el token coincide — así un proceso que revive
   * tarde nunca libera el lock que otro tomó legítimamente tras la expiración.
   */
  async liberar(contratoId: string, token: string): Promise<void> {
    await this.ds.query(
      `DELETE FROM ftth_operacion_lock WHERE contrato_id = $1 AND token = $2`,
      [contratoId, token],
    ).catch((e) => {
      this.logger.warn(`No se pudo liberar el lock | contrato=${contratoId}: ${e?.message}`);
    });
  }

  /**
   * Envuelve una operación: toma el lock, la ejecuta y SIEMPRE lo libera.
   * Es la forma preferida de usar el servicio — no deja locks colgados por
   * un `return` temprano o una excepción a media función.
   */
  async conLock<T>(
    contratoId: string,
    operacion:  OperacionFtth,
    fn:         () => Promise<T>,
  ): Promise<T> {
    const token = await this.adquirir(contratoId, operacion);
    try {
      return await fn();
    } finally {
      await this.liberar(contratoId, token);
    }
  }
}
