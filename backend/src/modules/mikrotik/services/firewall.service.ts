import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

// Lista de morosos: IPs bloqueadas por mora
export const ADDRESS_LIST_MOROSOS = 'morosos_datafast';
// Lista de IPs en prórroga (acceso limitado)
export const ADDRESS_LIST_PRORROGA = 'prorroga';
// Lista de IPs con acceso restringido al portal de pago
export const ADDRESS_LIST_PORTAL = 'portal-pago';

export interface DhcpStaticBinding {
  macAddress:    string;
  ipAddress:     string;
  hostname?:     string;
  comment?:      string;
  server?:       string;
  addressLists?: string;  // e.g. 'NORMAL'
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
      // Obtener todas las reglas una sola vez y filtrar en JS para evitar el bug
      // de RouterOS v7 donde ?comment=X devuelve !empty (no captureable con try/catch)
      let allRules: any[] = [];
      try {
        allRules = await api.write('/ip/firewall/filter/print');
      } catch (err: any) {
        if (err?.errno !== 'UNKNOWNREPLY') throw err;
        // !empty = no hay reglas todavía
      }

      await this.agregarReglaFirewallSiNoExiste(api, {
        chain:  'forward',
        srcList: ADDRESS_LIST_MOROSOS,
        action: 'drop',
        comment: 'DATAFAST: Bloquear morosos',
      }, allRules);

      await this.agregarReglaFirewallSiNoExiste(api, {
        chain:   'forward',
        srcList: ADDRESS_LIST_MOROSOS,
        dstPort: '80,443',
        proto:   'tcp',
        action:  'accept',
        comment: 'DATAFAST: Morosos portal pago',
        position: 'top',
      }, allRules);

      // Prórroga = acceso completo hasta vencimiento; el corte se aplica al pasar a morosos
      await this.agregarReglaFirewallSiNoExiste(api, {
        chain:   'forward',
        srcList: ADDRESS_LIST_PRORROGA,
        action:  'accept',
        comment: 'DATAFAST: Prorroga acceso completo',
      }, allRules);

      this.logger.log(`Reglas de control configuradas en ${creds.ip}`);
    });
  }

  // ── Inyectar regla principal de bloqueo morosos (al registrar router) ─
  // NOTA: NO usar '?comment=X' como filtro en el print — RouterOS v7 responde !empty
  // cuando no hay coincidencias, y node-routeros lanza UNKNOWNREPLY en un event-listener
  // (no como Promise rejection), por lo que try/catch no lo captura y la promesa queda
  // colgada indefinidamente. Fix: obtener TODAS las reglas sin filtro y buscar en JS.
  async inyectarReglaBloqueoMorosos(creds: RouterCredentials): Promise<void> {
    const comment = 'Datafast-Bloquear Morosos';
    const ruleArgs = [
      `=chain=forward`,
      `=src-address-list=${ADDRESS_LIST_MOROSOS}`,
      `=dst-address-list=!ips_permitidas_morosos_datafast`,
      `=action=drop`,
      `=comment=${comment}`,
    ];

    // Conexión 1: obtener todas las reglas sin filtro (filtro ?comment=X lanza
    // UNKNOWNREPLY en event-listener en v7, no captureable con try/catch en Promise)
    let existingId: string | null = null;
    const checkApi = await this.pool.connectDirect(creds);
    try {
      const allRules = await checkApi.write('/ip/firewall/filter/print');
      const match = allRules.find((r: any) => r.comment === comment);
      existingId = match ? match['.id'] : null;
    } catch (err: any) {
      if (err?.errno !== 'UNKNOWNREPLY') throw err;
      // !empty = no existe ninguna regla
    } finally {
      checkApi.close().catch(() => {});
    }

    // Conexión 2: actualizar si existe, agregar si no
    const writeApi = await this.pool.connectDirect(creds);
    try {
      if (existingId) {
        await writeApi.write('/ip/firewall/filter/set', [
          `=.id=${existingId}`,
          ...ruleArgs,
        ]);
        this.logger.log(`Regla '${comment}' actualizada en ${creds.ip}`);
      } else {
        await writeApi.write('/ip/firewall/filter/add', ruleArgs);
        this.logger.log(`Regla '${comment}' inyectada en ${creds.ip}`);
      }
    } finally {
      writeApi.close().catch(() => {});
    }
  }

  private async agregarReglaFirewallSiNoExiste(
    api:       any,
    params: {
      chain:    string;
      srcList?: string;
      dstList?: string;
      dstPort?: string;
      proto?:   string;
      action:   string;
      comment:  string;
      position?: 'top';
    },
    existingRules: any[],
  ): Promise<void> {
    // La búsqueda se hace en el array ya obtenido para evitar el bug de RouterOS v7
    // donde ?comment=X devuelve !empty → lanza UNKNOWNREPLY en event-listener (no en Promise)
    if (existingRules.some((r: any) => r.comment === params.comment)) return;

    const args = [
      `=chain=${params.chain}`,
      ...(params.srcList ? [`=src-address-list=${params.srcList}`] : []),
      ...(params.dstList ? [`=dst-address-list=${params.dstList}`] : []),
      ...(params.proto   ? [`=protocol=${params.proto}`]           : []),
      ...(params.dstPort ? [`=dst-port=${params.dstPort}`]         : []),
      `=action=${params.action}`,
      `=comment=${params.comment}`,
    ];

    if (params.position === 'top') {
      await api.write('/ip/firewall/filter/add', [...args, `=place-before=0`]);
    } else {
      await api.write('/ip/firewall/filter/add', args);
    }
  }

  // ────────────────────────────────────────────────────────────
  // DHCP STATIC BINDINGS — Amarre IP-MAC
  // ────────────────────────────────────────────────────────────

  // ── Crear/actualizar binding estático (upsert por MAC) ───────────────────
  // No usa ?mac-address= como filtro en el print para evitar el bug UNKNOWNREPLY
  // de RouterOS v7 con !empty en event-listener. Se obtienen todos los leases
  // sin filtro y se busca por MAC en JS.
  async crearDhcpBinding(creds: RouterCredentials, binding: DhcpStaticBinding): Promise<string> {
    const macFormatted = binding.macAddress.toUpperCase()
      .replace(/[^A-F0-9]/g, '')
      .match(/.{2}/g)!.join(':');

    // Conexión 1: leer todos los leases y buscar en JS
    let existingId: string | null = null;
    const checkApi = await this.pool.connectDirect(creds);
    try {
      const allLeases = await checkApi.write('/ip/dhcp-server/lease/print');
      const match = allLeases.find(
        (l: any) => (l['mac-address'] || '').toUpperCase() === macFormatted,
      );
      existingId = match ? match['.id'] : null;
    } catch (err: any) {
      if (err?.errno !== 'UNKNOWNREPLY') throw err;
    } finally {
      checkApi.close().catch(() => {});
    }

    const leaseArgs = [
      `=address=${binding.ipAddress}`,
      `=mac-address=${macFormatted}`,
      ...(binding.server       ? [`=server=${binding.server}`]            : []),
      ...(binding.hostname     ? [`=host-name=${binding.hostname}`]       : []),
      ...(binding.comment      ? [`=comment=${binding.comment}`]          : []),
      ...(binding.addressLists ? [`=address-lists=${binding.addressLists}`] : []),
    ];

    // Conexión 2: upsert
    const writeApi = await this.pool.connectDirect(creds);
    try {
      if (existingId) {
        await writeApi.write('/ip/dhcp-server/lease/set', [`=.id=${existingId}`, ...leaseArgs]);
        this.logger.log(`DHCP binding actualizado: ${macFormatted} → ${binding.ipAddress} en ${creds.ip}`);
        return existingId;
      } else {
        const result = await writeApi.write('/ip/dhcp-server/lease/add', leaseArgs);
        this.logger.log(`DHCP binding creado: ${macFormatted} → ${binding.ipAddress} en ${creds.ip}`);
        return result?.[0]?.ret || '';
      }
    } finally {
      writeApi.close().catch(() => {});
    }
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
