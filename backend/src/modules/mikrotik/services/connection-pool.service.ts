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

// ─────────────────────────────────────────────────────────────
// Pool de conexiones RouterOS
// Mantiene conexiones persistentes reutilizables por router.
// Máx. 3 conexiones por router (RouterOS limita por defecto a 10).
// Timeout de inactividad: 5 minutos.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class RouterConnectionPool implements OnModuleDestroy {
  private readonly logger = new Logger(RouterConnectionPool.name);

  // routerId → lista de conexiones
  private readonly pool = new Map<string, PooledConnection[]>();

  private readonly MAX_PER_ROUTER   = 3;
  private readonly IDLE_TIMEOUT_MS  = 5 * 60 * 1000;  // 5 minutos
  private readonly CONNECT_TIMEOUT  = 15_000;           // 15 segundos

  // Limpiar conexiones inactivas cada 2 minutos
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 2 * 60 * 1000);
  }

  // ── Obtener conexión (del pool o nueva) ────────────────────
  async acquire(creds: RouterCredentials): Promise<RouterOSAPI> {
    const routerId  = creds.id;
    const existing  = this.pool.get(routerId) || [];

    // Buscar conexión disponible (no busy)
    const available = existing.find((c) => !c.busy);
    if (available) {
      available.busy   = true;
      available.usedAt = new Date();
      this.logger.debug(`Pool hit: router ${routerId} | pool size: ${existing.length}`);
      return available.api;
    }

    // Si ya tenemos el máximo, lanzar error (no bloquear)
    if (existing.length >= this.MAX_PER_ROUTER) {
      throw new Error(
        `Pool exhausto para router ${routerId}: ${existing.length}/${this.MAX_PER_ROUTER} conexiones en uso. ` +
        `Intenta en unos segundos.`,
      );
    }

    // Crear nueva conexión
    const api = await this.connect(creds);

    const conn: PooledConnection = {
      api,
      routerId,
      usedAt:  new Date(),
      busy:    true,
      version: creds.version,
    };

    this.pool.set(routerId, [...existing, conn]);
    this.logger.debug(`Nueva conexión router ${routerId} | pool: ${existing.length + 1}`);
    return api;
  }

  // ── Liberar conexión al pool ────────────────────────────────
  release(routerId: string, api: RouterOSAPI): void {
    const conns = this.pool.get(routerId);
    if (!conns) return;

    const conn = conns.find((c) => c.api === api);
    if (conn) {
      conn.busy   = false;
      conn.usedAt = new Date();
    }
  }

  // ── Invalidar todas las conexiones de un router ────────────
  async invalidate(routerId: string): Promise<void> {
    const conns = this.pool.get(routerId) || [];
    for (const c of conns) {
      try { await c.api.close(); } catch { /* ignorar */ }
    }
    this.pool.delete(routerId);
    this.logger.log(`Pool invalidado: router ${routerId}`);
  }

  // ── Conexión directa sin pool (para operaciones únicas) ────
  async connectDirect(creds: RouterCredentials): Promise<RouterOSAPI> {
    return this.connect(creds);
  }

  // ── Cleanup de conexiones inactivas ─────────────────────────
  private cleanup(): void {
    const now     = Date.now();
    let removed   = 0;

    for (const [routerId, conns] of this.pool.entries()) {
      const activas = conns.filter((c) => {
        const idle = now - c.usedAt.getTime();
        if (!c.busy && idle > this.IDLE_TIMEOUT_MS) {
          try { c.api.close(); } catch { /* ignorar */ }
          removed++;
          return false; // eliminar
        }
        return true; // mantener
      });

      if (activas.length === 0) {
        this.pool.delete(routerId);
      } else {
        this.pool.set(routerId, activas);
      }
    }

    if (removed > 0) {
      this.logger.debug(`Pool cleanup: ${removed} conexiones inactivas eliminadas`);
    }
  }

  // ── Crear conexión RouterOS ──────────────────────────────────
  private async connect(creds: RouterCredentials): Promise<RouterOSAPI> {
    let password: string;
    try {
      password = decrypt(creds.passwordCifrado);
    } catch {
      password = creds.passwordCifrado; // sin cifrar (desarrollo)
    }

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
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let api: RouterOSAPI | null = null;

      try {
        api = await this.acquire(creds);
        const result = await fn(api);
        this.release(creds.id, api);
        return result;

      } catch (error) {
        lastError = error;

        // Si es error de conexión, invalidar el pool e intentar de nuevo
        if (api && this.isConnectionError(error)) {
          this.logger.warn(
            `Error de conexión router ${creds.id} (intento ${attempt + 1}): ${error.message}`,
          );
          await this.invalidate(creds.id);
          // Esperar antes de reintentar
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          }
        } else {
          // Error de comando (no de conexión) — no reintentar
          if (api) this.release(creds.id, api);
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
    // Cerrar todas las conexiones al apagar el servidor
    for (const [routerId, conns] of this.pool.entries()) {
      for (const c of conns) {
        try { await c.api.close(); } catch { /* ignorar */ }
      }
    }
    this.pool.clear();
    this.logger.log('Pool de conexiones RouterOS cerrado');
  }
}
