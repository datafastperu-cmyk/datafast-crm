import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials, PoolChannel } from './connection-pool.service';

export interface InterfaceInfo {
  name:        string;
  type:        string;    // 'ether' | 'wlan' | 'bridge' | 'vlan' | 'pppoe-in'
  macAddress:  string;
  mtu:         number;
  running:     boolean;
  disabled:    boolean;
  rxBytes:     number;
  txBytes:     number;
  rxRate:      number;    // bps actual
  txRate:      number;
  rxErrors:    number;
  txErrors:    number;
  lastLinkUp?: string;
  comment?:    string;
}

export interface RouterResources {
  version:        string;
  buildTime:      string;
  freeMemory:     number;     // bytes
  totalMemory:    number;
  cpuLoad:        number;     // %
  cpuFreq:        number;     // MHz
  freeHdd:        number;     // bytes
  totalHdd:       number;
  uptime:         string;     // '3d4h5m6s'
  uptimeSeconds:  number;
  boardName:      string;
  platform:       string;
  temperature?:   number;
}

export interface IpAddress {
  address:    string;     // '192.168.1.1/24'
  network:    string;     // '192.168.1.0'
  interface:  string;
  comment?:   string;
  disabled:   boolean;
}

export interface ArpEntry {
  address:    string;
  macAddress: string;
  interface:  string;
  dynamic:    boolean;
  complete:   boolean;
}

@Injectable()
export class InterfaceService {
  private readonly logger = new Logger(InterfaceService.name);

  constructor(private readonly pool: RouterConnectionPool) {}

  // ── Recursos del sistema ─────────────────────────────────
  async getRecursos(creds: RouterCredentials, channel: PoolChannel = 'provision'): Promise<RouterResources> {
    return this.pool.execute(creds, async (api) => {
      const [res] = await api.write('/system/resource/print');
      const uptime = res['uptime'] || '0s';

      return {
        version:      res['version']       || '',
        buildTime:    res['build-time']    || '',
        freeMemory:   parseInt(res['free-memory']  || '0', 10),
        totalMemory:  parseInt(res['total-memory'] || '0', 10),
        cpuLoad:      parseInt(res['cpu-load']     || '0', 10),
        cpuFreq:      parseInt(res['cpu-frequency']|| '0', 10),
        freeHdd:      parseInt(res['free-hdd-space']   || '0', 10),
        totalHdd:     parseInt(res['total-hdd-space']  || '0', 10),
        uptime:       uptime,
        uptimeSeconds: this.parseUptime(uptime),
        boardName:    res['board-name']    || '',
        platform:     res['platform']      || '',
        temperature:  parseInt(res['temperature'] || '0', 10) || undefined,
      };
    }, 2, channel);
  }

  // ── Identity del router ───────────────────────────────────
  async getIdentity(creds: RouterCredentials): Promise<string> {
    const [ident] = await this.pool.execute(creds, (api) =>
      api.write('/system/identity/print'),
    );
    return ident?.name || '';
  }

  // ── Listar interfaces con estadísticas ────────────────────
  async listarInterfaces(creds: RouterCredentials): Promise<InterfaceInfo[]> {
    return this.pool.execute(creds, async (api) => {
      const ifaces = await api.write('/interface/print');
      // Obtener estadísticas de tráfico en tiempo real
      const stats  = await api.write('/interface/monitor-traffic', [
        `=interface=${ifaces.map((i: any) => i.name).join(',')}`,
        `=once=`,
      ]).catch(() => []);

      const statsMap = new Map<string, any>();
      for (const s of stats) {
        statsMap.set(s.name, s);
      }

      return ifaces.map((i: any) => {
        const s = statsMap.get(i.name) || {};
        return {
          name:       i.name,
          type:       i.type || 'ether',
          macAddress: i['mac-address'] || '',
          mtu:        parseInt(i.mtu || '1500', 10),
          running:    i.running === 'true',
          disabled:   i.disabled === 'true',
          rxBytes:    parseInt(i['rx-byte'] || '0', 10),
          txBytes:    parseInt(i['tx-byte'] || '0', 10),
          rxRate:     parseInt(s['rx-bits-per-second'] || '0', 10),
          txRate:     parseInt(s['tx-bits-per-second'] || '0', 10),
          rxErrors:   parseInt(i['rx-error'] || '0', 10),
          txErrors:   parseInt(i['tx-error'] || '0', 10),
          lastLinkUp: i['last-link-up-time'],
          comment:    i.comment,
        };
      });
    });
  }

  // ── Monitoreo de tráfico en tiempo real de una interface ──
  async monitorearInterface(
    creds:     RouterCredentials,
    ifaceName: string,
    samples:   number = 3,
  ): Promise<{ rxBps: number; txBps: number; rxPps: number; txPps: number }[]> {
    return this.pool.execute(creds, async (api) => {
      const results: any[] = [];
      for (let i = 0; i < samples; i++) {
        const [data] = await api.write('/interface/monitor-traffic', [
          `=interface=${ifaceName}`,
          `=once=`,
        ]);
        results.push({
          rxBps: parseInt(data?.['rx-bits-per-second']    || '0', 10),
          txBps: parseInt(data?.['tx-bits-per-second']    || '0', 10),
          rxPps: parseInt(data?.['rx-packets-per-second'] || '0', 10),
          txPps: parseInt(data?.['tx-packets-per-second'] || '0', 10),
        });
        if (i < samples - 1) await new Promise((r) => setTimeout(r, 1000));
      }
      return results;
    });
  }

  // ── IPs asignadas al router ────────────────────────────────
  async listarIps(creds: RouterCredentials): Promise<IpAddress[]> {
    const ips = await this.pool.execute(creds, (api) =>
      api.write('/ip/address/print'),
    );
    return ips.map((ip: any) => ({
      address:   ip.address,
      network:   ip.network,
      interface: ip.interface,
      comment:   ip.comment,
      disabled:  ip.disabled === 'true',
    }));
  }

  // ── Tabla ARP ─────────────────────────────────────────────
  async getArp(creds: RouterCredentials, ip?: string): Promise<ArpEntry[]> {
    const args = ip ? [`?address=${ip}`] : [];
    const rows = await this.pool.execute(creds, (api) =>
      api.write('/ip/arp/print', args),
    );
    return rows.map((r: any) => ({
      address:    r.address,
      macAddress: r['mac-address'] || '',
      interface:  r.interface,
      dynamic:    r.dynamic  === 'true',
      complete:   r.complete === 'true',
    }));
  }

  // ── Rutas ─────────────────────────────────────────────────
  async listarRutas(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, (api) =>
      api.write('/ip/route/print'),
    );
  }

  // ── Log del sistema ───────────────────────────────────────
  async getLog(creds: RouterCredentials, limit = 50): Promise<any[]> {
    const logs = await this.pool.execute(creds, (api) =>
      api.write('/log/print'),
    );
    return logs.slice(-limit).reverse();
  }

  // ── Versión del RouterOS ──────────────────────────────────
  async detectarVersion(creds: RouterCredentials): Promise<'v6' | 'v7'> {
    try {
      const recursos = await this.getRecursos(creds);
      const version  = recursos.version || '';
      return version.startsWith('7') ? 'v7' : 'v6';
    } catch {
      return 'v6'; // Asumir v6 como fallback
    }
  }

  // ── Ping desde el router ─────────────────────────────────
  async ping(
    creds:   RouterCredentials,
    destino: string,
    count:   number = 4,
  ): Promise<{ avg: number; min: number; max: number; loss: number }> {
    return this.pool.execute(creds, async (api) => {
      const result = await api.write('/ping', [
        `=address=${destino}`,
        `=count=${count}`,
        `=interval=0.5`,
      ]);

      const times = result
        .filter((r: any) => r.time && r.time !== 'timeout')
        .map((r: any) => {
          const ms = r.time?.replace('ms', '') || '0';
          return parseFloat(ms);
        });

      const loss = result.filter((r: any) => r.status === 'timeout').length;
      const avg  = times.length ? times.reduce((a: number, b: number) => a + b, 0) / times.length : 0;

      return {
        avg:  Math.round(avg * 10) / 10,
        min:  times.length ? Math.min(...times) : 0,
        max:  times.length ? Math.max(...times) : 0,
        loss: Math.round((loss / count) * 100),
      };
    });
  }

  // ── Convertir uptime string a segundos ────────────────────
  parseUptime(uptime: string): number {
    let seconds = 0;
    const weeks   = uptime.match(/(\d+)w/);
    const days    = uptime.match(/(\d+)d/);
    const hours   = uptime.match(/(\d+)h/);
    const minutes = uptime.match(/(\d+)m/);
    const secs    = uptime.match(/(\d+)s/);
    if (weeks)   seconds += parseInt(weeks[1],   10) * 7 * 24 * 3600;
    if (days)    seconds += parseInt(days[1],    10) * 24 * 3600;
    if (hours)   seconds += parseInt(hours[1],   10) * 3600;
    if (minutes) seconds += parseInt(minutes[1], 10) * 60;
    if (secs)    seconds += parseInt(secs[1],    10);
    return seconds;
  }
}
