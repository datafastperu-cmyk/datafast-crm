import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RouterOSAPI } from 'node-routeros';
import { decrypt } from '../../../common/utils/encryption.util';

// ─── Conexión activa en el pool ────────────────────────────────
interface PooledConnection {
  api:        RouterOSAPI;
  routerId:   string;
  usedAt:     Date;
  busy:       boolean;
  version:    string; // 'v6' | 'v7'
}

// ─── Opciones de conexión ──────────────────────────────────────
export interface RouterCredentials {
  id:         string;
  ip:         string;
  port:       number;
  user:       string;
  passwordCifrado: string;
  useSsl:     boolean;
  timeoutSec: number;
  version:    string;
}

export type PoolChannel = 'monitoreo' | 'provision';

// ─────────────────────────────────────────────────────────────
// Pool de conexiones RouterOS con canales separados.
// 'monitoreo' y 'provision' tienen slots independientes para
// que el worker de monitoreo no bloquee las operaciones de
// aprovisionamiento y viceversa.
// Máx. por canal: 2 monitoreo / 3 provision.
// Timeout de inactividad: 5 minutos.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class RouterConnectionPool implements OnModuleDestroy {
  private readonly logger = new Logger(RouterConnectionPool.name);

  // canal → routerId → conexiones
  private readonly pools: Record<PoolChannel, Map<string, PooledConnection[]>> = {
    monitoreo: new Map(),
    provision: new Map(),
  };

  private readonly MAX_PER_CHANNEL: Record<PoolChannel, number> = {
    monitoreo: 2,
    provision: 3,
  };

  private readonly IDLE_TIMEOUT_MS  = 5 * 60 * 1000;
  private readonly CONNECT_TIMEOUT  = 15_000;

  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 2 * 60 * 1000);
  }

  // ── Obtener conexión (del pool o nueva) ────────────────────
  async acquire(creds: RouterCredentials, channel: PoolChannel = 'provision'): Promise<RouterOSAPI> {
    const routerId  = creds.id;
    const pool      = this.pools[channel];
    const existing  = pool.get(routerId) || [];
    const max       = this.MAX_PER_CHANNEL[channel];

    const available = existing.find((c) => !c.busy);
    if (available) {
      available.busy   = true;
      available.usedAt = new Date();
      this.logger.debug(`Pool hit [${channel}]: router ${routerId} | pool size: ${existing.length}`);
      return available.api;
    }

    if (existing.length >= max) {
      throw new Error(
        `Pool exhausto [${channel}] para router ${routerId}: ${existing.length}/${max} conexiones en uso.`,
      );
    }

    const api = await this.connect(creds);

    const conn: PooledConnection = {
      api,
      routerId,
      usedAt:  new Date(),
      busy:    true,
      version: creds.version,
    };

    pool.set(routerId, [...existing, conn]);
    this.logger.debug(`Nueva conexión [${channel}] router ${routerId} | pool: ${existing.length + 1}`);
    return api;
  }

  // ── Liberar conexión al pool ────────────────────────────────
  release(routerId: string, api: RouterOSAPI, channel: PoolChannel = 'provision'): void {
    const conns = this.pools[channel].get(routerId);
    if (!conns) return;

    const conn = conns.find((c) => c.api === api);
    if (conn) {
      conn.busy   = false;
      conn.usedAt = new Date();
    }
  }

  // ── Invalidar todas las conexiones de un router (ambos canales) ─
  async invalidate(routerId: string): Promise<void> {
    for (const channel of ['monitoreo', 'provision'] as PoolChannel[]) {
      const conns = this.pools[channel].get(routerId) || [];
      for (const c of conns) {
        try { await c.api.close(); } catch { /* ignorar */ }
      }
      this.pools[channel].delete(routerId);
    }
    this.logger.log(`Pool invalidado: router ${routerId}`);
  }

  // ── Conexión directa sin pool (para operaciones únicas) ────
  async connectDirect(creds: RouterCredentials): Promise<RouterOSAPI> {
    return this.connect(creds);
  }

  // ── Cleanup de conexiones inactivas (ambos canales) ─────────
  private cleanup(): void {
    const now   = Date.now();
    let removed = 0;

    for (const channel of ['monitoreo', 'provision'] as PoolChannel[]) {
      const pool = this.pools[channel];
      for (const [routerId, conns] of pool.entries()) {
        const activas = conns.filter((c) => {
          const idle = now - c.usedAt.getTime();
          if (!c.busy && idle > this.IDLE_TIMEOUT_MS) {
            try { c.api.close(); } catch { /* ignorar */ }
            removed++;
            return false;
          }
          return true;
        });

        if (activas.length === 0) pool.delete(routerId);
        else                      pool.set(routerId, activas);
      }
    }

    if (removed > 0) {
      this.logger.debug(`Pool cleanup: ${removed} conexiones inactivas eliminadas`);
    }
  }

  // ── Crear conexión RouterOS ──────────────────────────────────
  private async connect(creds: RouterCredentials): Promise<RouterOSAPI> {
    const password = decrypt(creds.passwordCifrado);

    const api = new RouterOSAPI({
      host:     creds.ip,
      user:     creds.user,
      password,
      port:     creds.port,
      timeout:  creds.timeoutSec,
      tls:      creds.useSsl ? { rejectUnauthorized: false } : undefined,
    });

    try {
      await Promise.race([
        api.connect(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout conectando a ${creds.ip}:${creds.port}`)),
            this.CONNECT_TIMEOUT),
        ),
      ]);

      this.logger.log(`Conectado: ${creds.ip}:${creds.port} (RouterOS ${creds.version})`);
      return api;

    } catch (error) {
      this.logger.error(`Error conectando a ${creds.ip}: ${error.message}`);
      throw new Error(`No se pudo conectar al router ${creds.ip}: ${error.message}`);
    }
  }

  // ── Ejecutar comando con manejo automático del pool ─────────
  async execute<T = any>(
    creds:   RouterCredentials,
    fn:      (api: RouterOSAPI) => Promise<T>,
    retries: number = 2,
    channel: PoolChannel = 'provision',
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let api: RouterOSAPI | null = null;

      try {
        api = await this.acquire(creds, channel);
        const result = await fn(api);
        this.release(creds.id, api, channel);
        return result;

      } catch (error) {
        lastError = error;

        if (api && this.isConnectionError(error)) {
          this.logger.warn(
            `Error de conexión [${channel}] router ${creds.id} (intento ${attempt + 1}): ${error.message}`,
          );
          await this.invalidate(creds.id);
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          }
        } else {
          if (api) this.release(creds.id, api, channel);
          throw error;
        }
      }
    }

    throw new Error(`Error persistente en router ${creds.id}: ${lastError.message}`);
  }

  private isConnectionError(error: Error): boolean {
    const msg = error.message?.toLowerCase() || '';
    return (
      msg.includes('connection') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('closed') ||
      msg.includes('reset')
    );
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.cleanupInterval);
    for (const channel of ['monitoreo', 'provision'] as PoolChannel[]) {
      for (const conns of this.pools[channel].values()) {
        for (const c of conns) {
          try { await c.api.close(); } catch { /* ignorar */ }
        }
      }
      this.pools[channel].clear();
    }
    this.logger.log('Pool de conexiones RouterOS cerrado');
  }
}
