import { Injectable, Logger } from '@nestjs/common';
import {
  RouterConnectionPool,
  RouterCredentials,
} from '../../mikrotik/services/connection-pool.service';
import type { Router } from '../../mikrotik/entities/router.entity';
import type { Nodo }   from '../entities/monitoreo.entity';

/**
 * NetWatchService — gestiona entradas /tool/netwatch en routers MikroTik.
 *
 * Cuando se registra un nodo con un router asociado, el sistema configura
 * automáticamente una entrada NetWatch en ese router. El router monitorea
 * el equipo desde su LAN y llama al webhook del VPS en cada cambio de estado.
 *
 * Compatible con RouterOS v6 (usa /tool fetch address=...) y v7 (/tool/fetch url=...).
 * Token de autenticación: variable de entorno NETWATCH_TOKEN.
 */
@Injectable()
export class NetWatchService {
  private readonly logger  = new Logger(NetWatchService.name);
  private readonly token   = process.env.NETWATCH_TOKEN ?? 'netwatch-token-change-me';
  private readonly vpsPort = parseInt(process.env.PORT ?? '3001', 10);

  constructor(private readonly pool: RouterConnectionPool) {}

  // ── Configura (o actualiza) la entrada NetWatch en el router ──
  async configure(nodo: Nodo, router: Router): Promise<void> {
    if (!this.ipInRouterSubnets(nodo.ipMonitoreo, router)) {
      this.logger.debug(
        `NetWatch omitido: ${nodo.ipMonitoreo} no está en subnets de ${router.nombre} — ` +
        `usa "Sincronizar redes" si las subnets no están cargadas`,
      );
      return;
    }

    const vpsIp    = this.vpsIpFrom(router);
    const interval = this.rosTime(Math.max(30, nodo.pingIntervaloSeg ?? 30));
    const comment  = this.commentKey(nodo.id);
    const up       = this.buildScript(vpsIp, nodo.id, 'online',  router.versionRos);
    const down     = this.buildScript(vpsIp, nodo.id, 'offline', router.versionRos);

    const api = await this.pool.connectDirect(this.toCreds(router));
    try {
      const entries: any[] = await api.write('/tool/netwatch/print');
      const existing = entries.find((e) => e.comment === comment);

      if (existing) {
        await api.write('/tool/netwatch/set', [
          `=.id=${existing['.id']}`,
          `=host=${nodo.ipMonitoreo}`,
          `=interval=${interval}`,
          `=up-script=${up}`,
          `=down-script=${down}`,
        ]);
        this.logger.log(`NetWatch actualizado: ${nodo.nombre} (${nodo.ipMonitoreo}) @ ${router.nombre}`);
      } else {
        await api.write('/tool/netwatch/add', [
          `=host=${nodo.ipMonitoreo}`,
          `=interval=${interval}`,
          `=up-script=${up}`,
          `=down-script=${down}`,
          `=comment=${comment}`,
        ]);
        this.logger.log(`NetWatch creado: ${nodo.nombre} (${nodo.ipMonitoreo}) @ ${router.nombre}`);
      }
    } catch (e) {
      this.logger.warn(`NetWatch configure falló [${router.nombre}/${nodo.nombre}]: ${e.message}`);
    } finally {
      try { await api.close(); } catch {}
    }
  }

  // ── Elimina la entrada NetWatch cuando se borra un nodo ──────
  async remove(nodoId: string, router: Router): Promise<void> {
    const comment = this.commentKey(nodoId);
    const api     = await this.pool.connectDirect(this.toCreds(router));
    try {
      const entries: any[] = await api.write('/tool/netwatch/print');
      const entry = entries.find((e) => e.comment === comment);
      if (entry) {
        await api.write('/tool/netwatch/remove', [`=.id=${entry['.id']}`]);
        this.logger.log(`NetWatch eliminado: nodo ${nodoId} @ ${router.nombre}`);
      }
    } catch (e) {
      this.logger.warn(`NetWatch remove falló [${router.nombre}]: ${e.message}`);
    } finally {
      try { await api.close(); } catch {}
    }
  }

  // ── Elimina todas las entradas gestionadas cuando se borra el router ──
  async removeAll(router: Router): Promise<void> {
    const api = await this.pool.connectDirect(this.toCreds(router));
    try {
      const entries: any[] = await api.write('/tool/netwatch/print');
      const managed = entries.filter((e) => e.comment?.startsWith('mnt-'));
      for (const e of managed) {
        await api.write('/tool/netwatch/remove', [`=.id=${e['.id']}`]);
      }
      if (managed.length) {
        this.logger.log(`NetWatch limpiado: ${managed.length} entradas en ${router.nombre}`);
      }
    } catch (e) {
      this.logger.warn(`NetWatch removeAll falló [${router.nombre}]: ${e.message}`);
    } finally {
      try { await api.close(); } catch {}
    }
  }

  // ── Verifica el token recibido en el webhook ─────────────────
  verifyToken(token: string): boolean {
    return token === this.token;
  }

  // ─── Privados ─────────────────────────────────────────────────

  /** Clave de identificación única por nodo (≤ 18 chars para RouterOS) */
  private commentKey(nodoId: string): string {
    return `mnt-${nodoId.replace(/-/g, '').slice(0, 12)}`;
  }

  /** IP del VPS accesible desde el router (extremo VPN del servidor) */
  private vpsIpFrom(router: Router): string {
    const vpnIp = router.vpnIp;
    if (!vpnIp) return process.env.VPS_VPN_IP ?? '10.8.0.1';
    // El VPS es la dirección .1 de la misma /24 donde está el router
    const parts = vpnIp.split('.');
    parts[3]    = '1';
    return parts.join('.');
  }

  /**
   * Script compatible con v6 y v7 que llama al webhook del VPS.
   * Usa :do {} on-error={} para ignorar errores de red silenciosamente.
   *
   * v7 → /tool/fetch url=... (path-style, preferido en v7)
   * v6 → /tool fetch address=... src-path=... (address-style, soportado desde v6.0)
   */
  private buildScript(
    vpsIp:   string,
    nodoId:  string,
    estado:  'online' | 'offline',
    version: string,
  ): string {
    const path = `/api/v1/monitoreo/webhook/netwatch?token=${this.token}&nodoId=${nodoId}&estado=${estado}`;

    if (version === 'v7') {
      return `:do { /tool/fetch url="http://${vpsIp}:${this.vpsPort}${path}" keep-result=no } on-error={}`;
    }
    // v6 (todas las versiones): address= + src-path=
    return `:do { /tool fetch address=${vpsIp} port=${this.vpsPort} src-path="${path}" mode=http keep-result=no } on-error={}`;
  }

  /** Convierte segundos a formato HH:MM:SS de RouterOS (válido en v6 y v7) */
  private rosTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  }

  /** Verifica si una IP está dentro de alguna subnet del router */
  private ipInRouterSubnets(ip: string, router: Router): boolean {
    return router.subnetsLocales?.some((subnet) => this.isInSubnet(ip, subnet)) ?? false;
  }

  private isInSubnet(ip: string, subnet: string): boolean {
    const [net, prefix] = subnet.split('/');
    const bits = parseInt(prefix, 10);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const parse = (a: string) =>
      a.split('.').reduce((acc, x) => ((acc << 8) | Number(x)) >>> 0, 0);
    return (parse(ip) & mask) === (parse(net) & mask);
  }

  private toCreds(router: Router): RouterCredentials {
    return {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.puertoApi      ?? 8728,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl        ?? false,
      timeoutSec:      router.timeoutConexion ?? 10,
      version:         router.versionRos     ?? 'desconocida',
    };
  }
}
