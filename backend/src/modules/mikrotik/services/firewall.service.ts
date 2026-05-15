import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

// Lista de morosos: IPs bloqueadas por mora
export const ADDRESS_LIST_MOROSOS = 'morosos';
// Lista de IPs en prórroga (acceso limitado)
export const ADDRESS_LIST_PRORROGA = 'prorroga';
// Lista de IPs con acceso restringido al portal de pago
export const ADDRESS_LIST_PORTAL = 'portal-pago';

export interface DhcpStaticBinding {
  macAddress:  string;
  ipAddress:   string;
  hostname?:   string;
  comment?:    string;
  server?:     string;  // nombre del servidor DHCP
}

@Injectable()
export class FirewallService {
  private readonly logger = new Logger(FirewallService.name);

  constructor(private readonly pool: RouterConnectionPool) {}

  // ────────────────────────────────────────────────────────────
  // ADDRESS LISTS — Control de acceso por mora
  //
  // La regla de firewall en RouterOS debe estar configurada:
  //   chain=forward src-address-list=morosos action=drop
  // Esta regla bloquea TODO el tráfico de IPs en la lista.
  // ────────────────────────────────────────────────────────────

  // ── Agregar IP a la lista de morosos (SUSPENDER) ──────────
  async suspenderCliente(
    creds:     RouterCredentials,
    ip:        string,
    clienteId: string,
    comment?:  string,
  ): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      // Verificar si ya está en la lista
      const existing = await api.write('/ip/firewall/address-list/print', [
        `?list=${ADDRESS_LIST_MOROSOS}`,
        `?address=${ip}`,
      ]);

      if (existing.length > 0) {
        this.logger.debug(`IP ${ip} ya en address-list ${ADDRESS_LIST_MOROSOS}`);
        return;
      }

      await api.write('/ip/firewall/address-list/add', [
        `=list=${ADDRESS_LIST_MOROSOS}`,
        `=address=${ip}`,
        `=comment=${comment || `ClienteID:${clienteId}`}`,
      ]);

      this.logger.log(`IP suspendida: ${ip} → ${ADDRESS_LIST_MOROSOS} en ${creds.ip}`);

      // También desconectar la sesión PPPoE activa del cliente
      // (se hace en el servicio orquestador que llama tanto a PPPoE como a Firewall)
    });
  }

  // ── Quitar IP de la lista de morosos (REACTIVAR) ──────────
  async reactivarCliente(creds: RouterCredentials, ip: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      // Quitar de TODAS las listas de control
      for (const lista of [ADDRESS_LIST_MOROSOS, ADDRESS_LIST_PRORROGA]) {
        const entries = await api.write('/ip/firewall/address-list/print', [
          `?list=${lista}`,
          `?address=${ip}`,
        ]);

        for (const entry of entries) {
          await api.write('/ip/firewall/address-list/remove', [
            `=.id=${entry['.id']}`,
          ]);
        }
      }

      this.logger.log(`IP reactivada: ${ip} en ${creds.ip}`);
    });
  }

  // ── Verificar si una IP está suspendida ────────────────────
  async estaEnListaMorosos(creds: RouterCredentials, ip: string): Promise<boolean> {
    const entries = await this.pool.execute(creds, (api) =>
      api.write('/ip/firewall/address-list/print', [
        `?list=${ADDRESS_LIST_MOROSOS}`,
        `?address=${ip}`,
      ]),
    );
    return entries.length > 0;
  }

  // ── Listar todas las IPs suspendidas ──────────────────────
  async listarMorosos(creds: RouterCredentials): Promise<Array<{ ip: string; comment: string; addedAt: string }>> {
    const entries = await this.pool.execute(creds, (api) =>
      api.write('/ip/firewall/address-list/print', [`?list=${ADDRESS_LIST_MOROSOS}`]),
    );

    return entries.map((e: any) => ({
      ip:       e.address,
      comment:  e.comment || '',
      addedAt:  e['creation-time'] || '',
    }));
  }

  // ── Mover IP a prórroga (acceso al portal de pago) ────────
  async aplicarProrroga(creds: RouterCredentials, ip: string, comment?: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      // Quitar de morosos
      const morosos = await api.write('/ip/firewall/address-list/print', [
        `?list=${ADDRESS_LIST_MOROSOS}`, `?address=${ip}`,
      ]);
      for (const e of morosos) {
        await api.write('/ip/firewall/address-list/remove', [`=.id=${e['.id']}`]);
      }

      // Agregar a prórroga
      const existing = await api.write('/ip/firewall/address-list/print', [
        `?list=${ADDRESS_LIST_PRORROGA}`, `?address=${ip}`,
      ]);
      if (existing.length === 0) {
        await api.write('/ip/firewall/address-list/add', [
          `=list=${ADDRESS_LIST_PRORROGA}`,
          `=address=${ip}`,
          `=comment=${comment || 'Prorroga activa'}`,
        ]);
      }

      this.logger.log(`Prórroga aplicada: ${ip} en ${creds.ip}`);
    });
  }

  // ────────────────────────────────────────────────────────────
  // CONFIGURAR REGLAS DE FIREWALL (primera vez)
  // Crea las reglas necesarias para que el sistema de suspensión funcione.
  // IMPORTANTE: Se deben agregar al principio de la cadena forward.
  // ────────────────────────────────────────────────────────────
  async configurarReglasControl(creds: RouterCredentials): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      // Regla 1: Bloquear morosos — drop total
      await this.agregarReglaFirewallSiNoExiste(api, {
        chain:  'forward',
        srcList: ADDRESS_LIST_MOROSOS,
        action: 'drop',
        comment: 'DATAFAST: Bloquear morosos',
      });

      // Regla 2: Morosos pueden acceder al portal de pago (DNS + HTTP portal)
      // Nota: esta regla debe ir ANTES de la de drop
      await this.agregarReglaFirewallSiNoExiste(api, {
        chain:   'forward',
        srcList: ADDRESS_LIST_MOROSOS,
        dstPort: '80,443',
        proto:   'tcp',
        action:  'accept',
        comment: 'DATAFAST: Morosos portal pago',
        position: 'top',
      });

      // Regla 3: Prorroga — acceso limitado (solo web)
      await this.agregarReglaFirewallSiNoExiste(api, {
        chain:   'forward',
        srcList: ADDRESS_LIST_PRORROGA,
        dstPort: '80,443,53',
        proto:   'tcp',
        action:  'accept',
        comment: 'DATAFAST: Prorroga acceso web',
      });

      await this.agregarReglaFirewallSiNoExiste(api, {
        chain:   'forward',
        srcList: ADDRESS_LIST_PRORROGA,
        action:  'drop',
        comment: 'DATAFAST: Prorroga bloquear resto',
      });

      this.logger.log(`Reglas de control configuradas en ${creds.ip}`);
    });
  }

  private async agregarReglaFirewallSiNoExiste(
    api:    any,
    params: {
      chain:    string;
      srcList?: string;
      dstPort?: string;
      proto?:   string;
      action:   string;
      comment:  string;
      position?: 'top';
    },
  ): Promise<void> {
    const existing = await api.write('/ip/firewall/filter/print', [
      `?comment=${params.comment}`,
    ]);
    if (existing.length > 0) return;

    const args = [
      `=chain=${params.chain}`,
      ...(params.srcList ? [`=src-address-list=${params.srcList}`] : []),
      ...(params.proto   ? [`=protocol=${params.proto}`]           : []),
      ...(params.dstPort ? [`=dst-port=${params.dstPort}`]         : []),
      `=action=${params.action}`,
      `=comment=${params.comment}`,
    ];

    if (params.position === 'top') {
      // Insertar al principio de la cadena
      await api.write('/ip/firewall/filter/add', [...args, `=place-before=0`]);
    } else {
      await api.write('/ip/firewall/filter/add', args);
    }
  }

  // ────────────────────────────────────────────────────────────
  // DHCP STATIC BINDINGS — Amarre IP-MAC
  // ────────────────────────────────────────────────────────────

  // ── Crear binding estático ────────────────────────────────
  async crearDhcpBinding(creds: RouterCredentials, binding: DhcpStaticBinding): Promise<string> {
    return this.pool.execute(creds, async (api) => {
      // Verificar si ya existe el binding para este MAC
      const existing = await api.write('/ip/dhcp-server/lease/print', [
        `?mac-address=${binding.macAddress}`,
      ]);

      const macFormatted = binding.macAddress.toUpperCase()
        .replace(/[^A-F0-9]/g, '')
        .match(/.{2}/g)!.join(':');

      if (existing.length > 0) {
        // Actualizar el binding existente
        await api.write('/ip/dhcp-server/lease/set', [
          `=.id=${existing[0]['.id']}`,
          `=address=${binding.ipAddress}`,
          `=mac-address=${macFormatted}`,
          ...(binding.hostname ? [`=host-name=${binding.hostname}`] : []),
          ...(binding.comment  ? [`=comment=${binding.comment}`]    : []),
        ]);
        this.logger.log(`DHCP binding actualizado: ${macFormatted} → ${binding.ipAddress}`);
        return existing[0]['.id'];
      }

      const result = await api.write('/ip/dhcp-server/lease/add', [
        `=address=${binding.ipAddress}`,
        `=mac-address=${macFormatted}`,
        ...(binding.server   ? [`=server=${binding.server}`]      : []),
        ...(binding.hostname ? [`=host-name=${binding.hostname}`] : []),
        ...(binding.comment  ? [`=comment=${binding.comment}`]    : []),
      ]);

      this.logger.log(`DHCP binding creado: ${macFormatted} → ${binding.ipAddress} en ${creds.ip}`);
      return result?.[0]?.ret || '';
    });
  }

  // ── Eliminar binding ──────────────────────────────────────
  async eliminarDhcpBinding(creds: RouterCredentials, macAddress: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const leases = await api.write('/ip/dhcp-server/lease/print', [
        `?mac-address=${macAddress.toUpperCase()}`,
      ]);
      for (const lease of leases) {
        await api.write('/ip/dhcp-server/lease/remove', [`=.id=${lease['.id']}`]);
      }
      this.logger.log(`DHCP binding eliminado: ${macAddress} en ${creds.ip}`);
    });
  }

  // ── Listar leases DHCP activos ────────────────────────────
  async listarDhcpLeases(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, (api) =>
      api.write('/ip/dhcp-server/lease/print'),
    );
  }

  // ── Listar servidores DHCP ────────────────────────────────
  async listarServidoresDhcp(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, (api) =>
      api.write('/ip/dhcp-server/print'),
    );
  }
}
