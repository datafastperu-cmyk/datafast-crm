import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

@Injectable()
export class ArpService {
  private readonly logger = new Logger(ArpService.name);

  constructor(private readonly pool: RouterConnectionPool) {}

  // ── Detectar qué interface del router tiene la subred del cliente ──
  // Consulta /ip/address y compara cada red con la IP del cliente.
  async detectarInterface(creds: RouterCredentials, clienteIp: string): Promise<string | null> {
    const addresses = await this.pool.execute(creds, (api) =>
      api.write('/ip/address/print'),
    );

    for (const addr of addresses) {
      if (!addr.address || !addr.interface) continue;
      const slash = addr.address.indexOf('/');
      if (slash < 0) continue;
      const prefix  = parseInt(addr.address.slice(slash + 1), 10);
      const network = addr.network || addr.address.slice(0, slash);
      if (this.enMismaRed(clienteIp, network, prefix)) {
        return addr.interface as string;
      }
    }
    return null;
  }

  // ── Crear ARP estático (upsert por address + interface) ──────────
  async crearArpEstatico(
    creds:    RouterCredentials,
    ip:       string,
    mac:      string,
    iface:    string,
    comment?: string,
  ): Promise<void> {
    const macFmt = mac.toUpperCase()
      .replace(/[^A-F0-9]/g, '')
      .match(/.{2}/g)!.join(':');

    await this.pool.execute(creds, async (api) => {
      const existing = await api.write('/ip/arp/print', [
        `?address=${ip}`,
        `?interface=${iface}`,
      ]);

      if (existing.length > 0) {
        await api.write('/ip/arp/set', [
          `=.id=${existing[0]['.id']}`,
          `=mac-address=${macFmt}`,
          ...(comment ? [`=comment=${comment}`] : []),
        ]);
        this.logger.log(`ARP actualizado: ${ip} → ${macFmt} (${iface}) en ${creds.ip}`);
      } else {
        await api.write('/ip/arp/add', [
          `=address=${ip}`,
          `=mac-address=${macFmt}`,
          `=interface=${iface}`,
          ...(comment ? [`=comment=${comment}`] : []),
        ]);
        this.logger.log(`ARP creado: ${ip} → ${macFmt} (${iface}) en ${creds.ip}`);
      }
    });
  }

  // ── Eliminar ARP estático por IP (solo entradas estáticas) ────────
  async eliminarArpEstatico(creds: RouterCredentials, ip: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const entries = await api.write('/ip/arp/print', [`?address=${ip}`]);
      for (const e of entries) {
        if (e.dynamic === 'true') continue;
        await api.write('/ip/arp/remove', [`=.id=${e['.id']}`]);
      }
      this.logger.log(`ARP eliminado: ${ip} en ${creds.ip}`);
    });
  }

  // ── Utilidades de red ─────────────────────────────────────────────

  private enMismaRed(ip: string, network: string, prefix: number): boolean {
    const mask   = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const ipInt  = this.ipToInt(ip);
    const netInt = this.ipToInt(network);
    return (ipInt & mask) === (netInt & mask);
  }

  private ipToInt(ip: string): number {
    return ip.split('.').reduce((acc, oct) => ((acc << 8) | parseInt(oct, 10)) >>> 0, 0);
  }
}
