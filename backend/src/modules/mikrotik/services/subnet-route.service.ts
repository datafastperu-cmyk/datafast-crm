import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Router } from '../entities/router.entity';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

const execAsync = promisify(exec);

// Prefijos de interfaces VPN/tunnel — se excluyen al descubrir subnets LAN
const VPN_PREFIXES = ['ovpn', 'tun', 'l2tp', 'pptp', 'ppp', 'sstp', 'eoip', 'vlan', 'lo'];

// Solo subnets RFC-1918
const PRIVATE = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

@Injectable()
export class SubnetRouteService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubnetRouteService.name);

  constructor(
    @InjectRepository(Router) private readonly routerRepo: Repository<Router>,
    private readonly pool: RouterConnectionPool,
  ) {}

  // Restaura todas las rutas al arrancar (PM2 restart limpia ip route)
  async onApplicationBootstrap() {
    try {
      const routers = await this.routerRepo.find({
        where: { activo: true },
        select: ['id', 'vpnIp', 'ipGestion', 'subnetsLocales'] as any,
      });
      let total = 0;
      for (const r of routers) {
        if (!r.subnetsLocales?.length) continue;
        const gw = r.vpnIp || r.ipGestion;
        await this.applyVpsRoutes(gw, r.subnetsLocales);
        total += r.subnetsLocales.length;
      }
      if (total > 0) this.logger.log(`Rutas restauradas al arrancar: ${total} subnets`);
    } catch (e) {
      this.logger.warn(`No se pudieron restaurar rutas: ${e.message}`);
    }
  }

  // Pinga una IP desde el propio router (relay) via RouterOS /tool/ping
  async pingViaRouter(router: Router, targetIp: string): Promise<{
    alive: boolean;
    latenciaMs: number | null;
    error?: string;
  }> {
    const creds = this.buildCreds(router);
    const api   = await this.pool.connectDirect(creds);
    try {
      const rows: any[] = await api.write('/tool/ping', [
        `=address=${targetIp}`,
        '=count=3',
        '=interval=500ms',
      ]);
      // La última fila del resultado contiene el resumen (sent / received / avg-rtt)
      const summary = [...rows].reverse().find(r => r.received !== undefined) ?? rows[rows.length - 1];
      const received = parseInt(summary?.received ?? '0', 10);
      const alive    = received > 0;
      const avgRtt   = summary?.['avg-rtt'] ? parseFloat(summary['avg-rtt']) : null;
      return { alive, latenciaMs: avgRtt };
    } catch (e) {
      return { alive: false, latenciaMs: null, error: e.message };
    } finally {
      try { await api.close(); } catch {}
    }
  }

  // Conecta al router vía RouterOS API y obtiene subnets LAN
  async fetchSubnets(router: Router): Promise<string[]> {
    const creds = this.buildCreds(router);
    const api   = await this.pool.connectDirect(creds);
    try {
      const addrs: any[] = await api.write('/ip/address/print');
      const subnets: string[] = [];

      for (const a of addrs) {
        const ifaceLow: string = (a.interface ?? '').toLowerCase();
        const address:  string = a.address ?? '';
        if (!address.includes('/')) continue;

        if (VPN_PREFIXES.some(p => ifaceLow.startsWith(p))) continue;

        const [ip, prefix] = address.split('/');
        const prefixNum = parseInt(prefix, 10);
        if (isNaN(prefixNum)) continue;

        if (!PRIVATE.some(r => r.test(ip))) continue;
        if (ip === router.vpnIp || ip === router.ipGestion) continue;

        const network = this.toNetworkAddr(ip, prefixNum);
        subnets.push(`${network}/${prefixNum}`);
      }

      return [...new Set(subnets)];
    } finally {
      try { await api.close(); } catch {}
    }
  }

  // Aplica rutas en el VPS (ip route replace — idempotente)
  async applyVpsRoutes(gateway: string, subnets: string[]): Promise<void> {
    for (const subnet of subnets) {
      try {
        await execAsync(`ip route replace ${subnet} via ${gateway}`);
        this.logger.debug(`Ruta: ${subnet} via ${gateway}`);
      } catch (e) {
        this.logger.warn(`Error ruta ${subnet} via ${gateway}: ${e.message}`);
      }
    }
  }

  // Elimina rutas del VPS (cuando se borra un router o cambian sus subnets)
  async removeVpsRoutes(gateway: string, subnets: string[]): Promise<void> {
    for (const subnet of subnets) {
      try {
        await execAsync(`ip route del ${subnet} via ${gateway} 2>/dev/null || true`);
      } catch {}
    }
  }

  private buildCreds(router: Router): RouterCredentials {
    return {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.puertoApi ?? 8728,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl ?? false,
      timeoutSec:      router.timeoutConexion ?? 10,
      version:         router.versionRos ?? 'desconocida',
    };
  }

  private toNetworkAddr(ip: string, prefix: number): string {
    const parts = ip.split('.').map(Number);
    const mask  = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const ipInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    const net   = (ipInt & mask) >>> 0;
    return [net >>> 24, (net >>> 16) & 0xFF, (net >>> 8) & 0xFF, net & 0xFF].join('.');
  }
}
