import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_LOCK_CLIENT } from '../redis/redis-lock.service';

// ─────────────────────────────────────────────────────────────────────────
// CircuitBreakerRegistry
//
// Protege contra cascadas de timeouts cuando un proveedor de mensajería
// cae. Sin CB: 500 mensajes × 15s timeout × 2 intentos = 250+ minutos
// bloqueados. Con CB: tras 5 fallos consecutivos, las llamadas se cortocircuitan
// y el queue drena en segundos.
//
// Estado por clave "{empresaId}:{proveedor}":
//
//   CLOSED    → operación normal; fallos consecutivos incrementan el contador
//   OPEN      → proveedor caído; fast-fail inmediato sin hacer HTTP
//   HALF_OPEN → cooldown expirado; se permite UN probe para verificar recuperación
//
// Transiciones:
//   CLOSED    → OPEN      : failureThreshold fallos consecutivos
//   OPEN      → HALF_OPEN : cooldownMs transcurrido + sin probe en vuelo
//   HALF_OPEN → CLOSED    : probe exitoso
//   HALF_OPEN → OPEN      : probe fallido (reset del timer de cooldown)
//
// Implementación híbrida: in-memory para lecturas síncronas (no rompe callers)
// + Redis para persistencia entre reinicios y consistencia entre procesos PM2.
// ─────────────────────────────────────────────────────────────────────────

type CbState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerEntry {
  state:        CbState;
  failures:     number;
  openedAt:     number;
  halfOpenLock: boolean;
}

export interface CbStatus {
  state:         CbState;
  failures:      number;
  openedAgoSec?: number;
}

const REDIS_KEY_PREFIX = 'cb:';
const REDIS_TTL_SEC    = 86_400; // 24h — auto-limpia CBs sin actividad

@Injectable()
export class CircuitBreakerRegistry implements OnModuleInit {
  private readonly logger   = new Logger(CircuitBreakerRegistry.name);
  private readonly breakers = new Map<string, BreakerEntry>();

  private readonly FAILURE_THRESHOLD = 5;
  private readonly COOLDOWN_MS       = 60_000;

  constructor(
    @Inject(REDIS_LOCK_CLIENT) private readonly redis: Redis,
  ) {}

  // Restaura el estado desde Redis al arrancar — garantiza que un reinicio
  // de PM2 no borre el historial de fallos de un proveedor caído.
  async onModuleInit(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${REDIS_KEY_PREFIX}*`);
      for (const rKey of keys) {
        const data = await this.redis.hgetall(rKey);
        if (!data?.state) continue;
        const cbKey = rKey.slice(REDIS_KEY_PREFIX.length);
        this.breakers.set(cbKey, {
          state:        (data.state as CbState) || 'CLOSED',
          failures:     parseInt(data.failures || '0', 10),
          openedAt:     parseInt(data.openedAt || '0', 10),
          halfOpenLock: data.halfOpenLock === '1',
        });
      }
      if (keys.length) {
        this.logger.log(`[CB] Estado restaurado desde Redis: ${keys.length} breaker(s)`);
      }
    } catch (err: any) {
      this.logger.warn(`[CB] No se pudo restaurar estado desde Redis: ${err.message} — arrancando limpio`);
    }
  }

  // ── Verificar si se puede proceder con la llamada al proveedor ────────
  canProceed(key: string): boolean {
    const b = this.getOrCreate(key);

    if (b.state === 'CLOSED') return true;

    if (b.state === 'OPEN') {
      const elapsed = Date.now() - b.openedAt;
      if (elapsed >= this.COOLDOWN_MS && !b.halfOpenLock) {
        b.state        = 'HALF_OPEN';
        b.halfOpenLock = true;
        this.logger.log(`[CB] '${key}': OPEN → HALF_OPEN (probe autorizado tras ${Math.round(elapsed / 1000)}s)`);
        this.persistAsync(key, b);
        return true;
      }
      return false;
    }

    // HALF_OPEN: solo un probe a la vez
    return false;
  }

  onSuccess(key: string): void {
    const b = this.getOrCreate(key);
    if (b.state === 'HALF_OPEN') {
      this.logger.log(`[CB] '${key}': HALF_OPEN → CLOSED (probe exitoso)`);
    }
    b.state        = 'CLOSED';
    b.failures     = 0;
    b.halfOpenLock = false;
    this.persistAsync(key, b);
  }

  onFailure(key: string): void {
    const b = this.getOrCreate(key);
    b.failures++;
    b.halfOpenLock = false;

    if (b.state === 'HALF_OPEN') {
      b.state    = 'OPEN';
      b.openedAt = Date.now();
      this.logger.warn(`[CB] '${key}': HALF_OPEN → OPEN (probe fallido, cooldown reiniciado)`);
      this.persistAsync(key, b);
      return;
    }

    if (b.state === 'CLOSED' && b.failures >= this.FAILURE_THRESHOLD) {
      b.state    = 'OPEN';
      b.openedAt = Date.now();
      this.logger.warn(
        `[CB] '${key}': CLOSED → OPEN ` +
        `(${b.failures} fallos consecutivos — proveedor considerado caído)`,
      );
    }
    this.persistAsync(key, b);
  }

  reset(key: string): void {
    const b = this.breakers.get(key);
    if (b) {
      b.state        = 'CLOSED';
      b.failures     = 0;
      b.openedAt     = 0;
      b.halfOpenLock = false;
      this.persistAsync(key, b);
      this.logger.log(`[CB] '${key}': reset manual → CLOSED`);
    }
  }

  resetAll(): void {
    for (const key of this.breakers.keys()) this.reset(key);
  }

  getStatus(): Record<string, CbStatus> {
    const result: Record<string, CbStatus> = {};
    for (const [key, b] of this.breakers) {
      result[key] = {
        state:    b.state,
        failures: b.failures,
        ...(b.state !== 'CLOSED'
          ? { openedAgoSec: Math.round((Date.now() - b.openedAt) / 1000) }
          : {}),
      };
    }
    return result;
  }

  private getOrCreate(key: string): BreakerEntry {
    if (!this.breakers.has(key)) {
      this.breakers.set(key, { state: 'CLOSED', failures: 0, openedAt: 0, halfOpenLock: false });
    }
    return this.breakers.get(key)!;
  }

  // Fire-and-forget: escribe el estado en Redis sin bloquear el caller síncrono.
  // Si Redis no responde, el estado en memoria es la fuente de verdad hasta el próximo reinicio.
  private persistAsync(key: string, b: BreakerEntry): void {
    this.redis
      .hset(REDIS_KEY_PREFIX + key, {
        state:        b.state,
        failures:     b.failures.toString(),
        openedAt:     b.openedAt.toString(),
        halfOpenLock: b.halfOpenLock ? '1' : '0',
      })
      .then(() => this.redis.expire(REDIS_KEY_PREFIX + key, REDIS_TTL_SEC))
      .catch((err: Error) =>
        this.logger.warn(`[CB] No se pudo persistir estado de '${key}' en Redis: ${err.message}`),
      );
  }
}
