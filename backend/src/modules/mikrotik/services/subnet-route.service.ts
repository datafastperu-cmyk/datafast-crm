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

  // Verifica si un CIDR específico está configurado en el router.
  // A diferencia de fetchSubnets(), incluye VLAN e interfaces lógicas
  // porque el pool de IPs puede vivir en cualquier tipo de interfaz.
  async verificarCidrEnRouter(router: Router, cidrNormalizado: string): Promise<{
    existe: boolean;
    redesEnRouter: string[];
  }> {
    const creds = this.buildCreds(router);
    const api   = await this.pool.connectDirect(creds);
    try {
      const addrs: any[] = await api.write('/ip/address/print');
      const redesEnRouter: string[] = [];

      for (const a of addrs) {
        const ifaceLow: string = (a.interface ?? '').toLowerCase();
        const address:  string = a.address ?? '';
        if (!address.includes('/')) continue;

        // Solo excluir túneles punto-a-punto (no VLANs — un ISP puede tener pools en VLANs)
        const esTunel = ['ovpn', 'tun', 'l2tp', 'pptp', 'ppp', 'sstp', 'eoip', 'lo']
          .some(p => ifaceLow.startsWith(p));
        if (esTunel) continue;

        const [ip, prefix] = address.split('/');
        const prefixNum = parseInt(prefix, 10);
        if (isNaN(prefixNum)) continue;

        if (!PRIVATE.some(r => r.test(ip))) continue;

        const network = this.toNetworkAddr(ip, prefixNum);
        redesEnRouter.push(`${network}/${prefixNum}`);
      }

      const redesUnicas = [...new Set(redesEnRouter)];
      return { existe: redesUnicas.includes(cidrNormalizado), redesEnRouter: redesUnicas };
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

  /**
   * Elimina rutas del VPS (al borrar un router o cuando cambian sus subnets).
   *
   * VIO hacia adentro: la versión anterior era `ip route del ... 2>/dev/null || true`
   * dentro de un `catch {}` vacío. Esa combinación hacía **imposible** que el método
   * reportara un fallo: afirmaba "rutas eliminadas" sin haberlo comprobado nunca, que es
   * el mismo `success: true` sin verificar que la regla VIO existe para impedir.
   *
   * Tenía tres formas de fallar en silencio, y las tres son reales:
   *
   *  1. `ip route del <subnet> via <gateway>` sólo borra si el gateway coincide EXACTO.
   *     Si el `vpnIp` del router cambió desde que se creó la ruta —cosa que pasa al
   *     re-registrar un router— el `del` no encuentra nada y no se entera nadie.
   *  2. El llamador sólo invoca este método `if (router.subnetsLocales?.length)`. Si esa
   *     columna quedó vacía, no se limpia nada aunque el kernel tenga las rutas.
   *  3. Cualquier otro error (permisos, subnet mal formada) quedaba tragado.
   *
   * Ahora se verifica el efecto con una lectura independiente (`ip route show`) y se
   * devuelve qué pasó realmente con cada subnet. Un residuo NO se reporta como éxito.
   *
   * No lanza: la baja de un router no debe abortarse porque una ruta se resista. El
   * llamador decide qué hacer con el reporte — pero ahora existe un reporte.
   */
  async removeVpsRoutes(
    gateway: string,
    subnets: string[],
  ): Promise<{ eliminadas: string[]; noExistian: string[]; residuales: string[] }> {
    const eliminadas: string[] = [];
    const noExistian: string[] = [];
    const residuales: string[] = [];

    for (const subnet of subnets) {
      const existiaAntes = await this._rutaExiste(subnet);

      if (!existiaAntes) {
        // Ya no estaba: es ÉXITO idempotente, no un fallo. Reejecutar una limpieza ya
        // aplicada no puede contar como error.
        noExistian.push(subnet);
        continue;
      }

      try {
        // Sin `via <gateway>`: se borra la ruta a esa subnet exista con el gateway que
        // exista. Filtrar por gateway era justamente lo que dejaba residuos cuando la IP
        // de VPN del router había cambiado. La subnet es del router que se está dando de
        // baja, así que su ruta le pertenece sin importar por dónde apunte hoy.
        await this._ejecutar(`ip route del ${subnet}`);
      } catch (e: any) {
        this.logger.warn(`Fallo al borrar ruta ${subnet}: ${e?.message ?? e}`);
      }

      // VERIFICACIÓN: comando de lectura independiente, no el eco del anterior.
      if (await this._rutaExiste(subnet)) {
        residuales.push(subnet);
        this.logger.error(
          `Ruta ${subnet} SIGUE presente en el VPS tras intentar eliminarla ` +
          `(gateway esperado: ${gateway}). Requiere revisión manual: ip route del ${subnet}`,
        );
      } else {
        eliminadas.push(subnet);
      }
    }

    // El log describe lo que ocurrió, no lo que se pretendía hacer.
    if (subnets.length) {
      this.logger.log(
        `Rutas VPS (gw ${gateway}): ${eliminadas.length} eliminadas, ` +
        `${noExistian.length} ya no existían, ${residuales.length} residuales.`,
      );
    }

    return { eliminadas, noExistian, residuales };
  }

  /**
   * Único punto donde este servicio toca la tabla de rutas del sistema.
   *
   * Existe como método y no como llamada directa a `execAsync` para que la verificación
   * VIO sea testeable: `promisify(exec)` se resuelve al cargar el módulo, así que
   * interceptarlo después es imposible. Sin este punto de corte, la garantía de que un
   * residuo se detecta no tendría test — y una garantía sin test es un comentario.
   */
  private async _ejecutar(cmd: string): Promise<{ stdout: string }> {
    return execAsync(cmd);
  }

  /** Lectura independiente del plano operativo. Es la sonda de verificación de VIO. */
  private async _rutaExiste(subnet: string): Promise<boolean> {
    try {
      const { stdout } = await this._ejecutar(`ip route show ${subnet}`);
      return stdout.trim().length > 0;
    } catch {
      // `ip route show` con una subnet inválida falla; tratarlo como "no existe" evitaría
      // el borrado y ocultaría el problema. Se reporta como existente para que la
      // verificación lo marque como residual y quede constancia.
      return true;
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
