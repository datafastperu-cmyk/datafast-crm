import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

export const REDIS_LOCK_CLIENT = 'REDIS_LOCK_CLIENT';

// Lua script atómico: solo libera si el token coincide (evita liberar locks de otro proceso)
const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_LOCK_CLIENT) private readonly redis: Redis) {}

  /**
   * Intenta adquirir un lock distribuido.
   * Retorna un token único si lo adquirió, o null si ya está tomado.
   */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  /**
   * Libera el lock solo si el token coincide (atómico vía Lua).
   * Previene que un proceso libere el lock de otro proceso.
   */
  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
  }

  /**
   * Ejecuta fn dentro de un lock distribuido.
   * Si no adquiere el lock en el primer intento, lanza Error.
   * El lock siempre se libera en finally, incluso si fn lanza.
   */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const token = await this.acquire(key, ttlMs);
    if (!token) {
      throw new Error(`No se pudo adquirir lock distribuido: ${key} — recurso en uso por otro proceso`);
    }
    try {
      return await fn();
    } finally {
      await this.release(key, token).catch((err) =>
        this.logger.warn(`[RedisLock] Error liberando lock ${key}: ${err.message}`),
      );
    }
  }
}
