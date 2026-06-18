import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RouterOSAPI } from 'node-routeros';
import { decrypt } from '../../../common/utils/encryption.util';

// ── Patch A: RouterOS v7 envía '!empty' en vez de '!done' cuando un /print filtrado
// devuelve lista vacía. node-routeros no reconoce '!empty' → onUnknown() lanza
// sincrónicamente dentro del EventEmitter → write() Promise cuelga hasta timeout.
// Solución: tratamos '!empty' como '!done' vacío para que el Promise resuelva.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RosChannel = require('node-routeros/dist/Channel').Channel;
  const _orig: (packet: string[]) => void = RosChannel.prototype.processPacket;
  RosChannel.prototype.processPacket = function (packet: string[]) {
    if (Array.isArray(packet) && packet[0] === '!empty') packet[0] = '!done';
    return _orig.call(this, packet);
  };
} catch {
  // Si la versión de la librería cambia y el path es distinto, continuar sin el patch.
}

// ── Patch B: RouterOS v7 envía TANTO '!empty' COMO '!done' para el mismo tag cuando
// un /print filtrado no tiene resultados. El Patch A convierte '!empty'→'!done', el
// Channel resuelve y cierra el tag. Cuando llega el '!done' real, Receiver.sendTagData
// no encuentra el tag y lanza UNREGISTEREDTAG sincrónicamente, dejando
// processingSentencePipe=true de forma permanente → todos los write() posteriores
// en esa conexión nunca reciben respuesta → timeout 30 s.
// Solución: si el tag ya no existe, limpiar estado y retornar en lugar de lanzar.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RosReceiver = require('node-routeros/dist/connector/Receiver').Receiver;
  const _origSend: (tag: string) => void = RosReceiver.prototype.sendTagData;
  RosReceiver.prototype.sendTagData = function (currentTag: string) {
    const tag = this.tags.get(currentTag);
    if (!tag) {
      this.cleanUp();
      return;
    }
    return _origSend.call(this, currentTag);
  };
} catch {
  // Continuar sin el patch si cambia la librería.
}

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
    provision: 5,
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
      let released = false;

      try {
        api = await this.acquire(creds, channel);

        const result = await fn(api);
        this.release(creds.id, api, channel);
        released = true;
        return result;

      } catch (error) {
        lastError = error;

        if (api && this.isConnectionError(error)) {
          this.logger.warn(
            `Error de conexión [${channel}] router ${creds.id} (intento ${attempt + 1}): ${error.message}`,
          );
          // invalidate cierra y borra el pool → siempre libera la conexión
          await this.invalidate(creds.id);
          released = true;
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          }
        } else {
          if (api && !released) {
            this.release(creds.id, api, channel);
            released = true;
          }
          throw error;
        }
      } finally {
        // Guardia de seguridad: si por cualquier camino imprevisto la conexión
        // sigue marcada busy, la liberamos para evitar leak permanente.
        if (api && !released) {
          this.release(creds.id, api, channel);
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
