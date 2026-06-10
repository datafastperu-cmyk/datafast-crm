import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

// Lista de morosos: IPs bloqueadas por mora
export const ADDRESS_LIST_MOROSOS = 'morosos_datafast';
// Lista de IPs en prórroga (acceso completo hasta vencimiento)
export const ADDRESS_LIST_PRORROGA = 'prorroga_datafast';

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

      // Quitar de prorroga si estaba ahí
      const prorroga = await api.write('/ip/firewall/address-list/print', [
        `?list=${ADDRESS_LIST_PRORROGA}`,
        `?address=${ip}`,
      ]);
      for (const e of prorroga) {
        await api.write('/ip/firewall/address-list/remove', [`=.id=${e['.id']}`]);
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
      // Quitar de TODAS las listas de control (incluye nombre legacy 'prorroga')
      for (const lista of [ADDRESS_LIST_MOROSOS, ADDRESS_LIST_PRORROGA, 'prorroga']) {
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

  // ── Mover IP a prórroga (acceso completo hasta vencimiento) ──
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

  // ── Configurar/reparar las 2 reglas de control (idempotente) ───────────
  // Orden garantizado en cadena forward:
  //   pos 0 → DROP morosos    (bloquea todo el tráfico de IPs en mora)
  //   pos 1 → PRORROGA accept (acceso completo — antes de cualquier default-deny)
  //
  // Si las reglas existen con orden incorrecto o dst-address-list legacy,
  // se eliminan y recrean. Inserción inversa en pos 0: prorroga primero,
  // drop segundo → resultado final: drop(0) prorroga(1).
  async configurarReglasControl(creds: RouterCredentials): Promise<void> {
    const DROP_COMMENT     = 'Datafast-Bloquear Morosos';
    const PRORROGA_COMMENT = 'DATAFAST: Prorroga acceso completo';

    // Conexión 1: leer sin filtros (bug UNKNOWNREPLY de v7 con ?comment=X)
    let allRules: any[] = [];
    const checkApi = await this.pool.connectDirect(creds);
    try {
      allRules = await checkApi.write('/ip/firewall/filter/print');
    } catch (err: any) {
      if (err?.errno !== 'UNKNOWNREPLY') throw err;
    } finally {
      checkApi.close().catch(() => {});
    }

    const dropIdx     = allRules.findIndex((r: any) => r.comment === DROP_COMMENT);
    const prorrogaIdx = allRules.findIndex((r: any) => r.comment === PRORROGA_COMMENT);
    // Eliminar regla portal pago si existe de instalaciones previas
    const portalIdx   = allRules.findIndex((r: any) => r.comment === 'DATAFAST: Morosos portal pago');

    const dropRule     = dropIdx     >= 0 ? allRules[dropIdx]     : null;
    const prorrogaRule = prorrogaIdx >= 0 ? allRules[prorrogaIdx] : null;
    const portalRule   = portalIdx   >= 0 ? allRules[portalIdx]   : null;

    const allExist  = !!(dropRule && prorrogaRule);
    const orderOk   = allExist && dropIdx < prorrogaIdx;
    const dropClean = !dropRule?.['dst-address-list'];

    if (allExist && orderOk && dropClean && !portalRule) {
      this.logger.debug(`Reglas de control ya correctas en ${creds.ip}`);
      return;
    }

    // Conexión 2: eliminar las que existan (incluye portal pago legacy) y recrear
    const writeApi = await this.pool.connectDirect(creds);
    try {
      for (const rule of [dropRule, prorrogaRule, portalRule]) {
        if (rule) await writeApi.write('/ip/firewall/filter/remove', [`=.id=${rule['.id']}`]);
      }

      // Añadir al final (sin place-before) para soportar cadena forward vacía.
      // place-before=0 falla con "no such item" cuando la cadena está vacía.
      const addDropRes     = await writeApi.write('/ip/firewall/filter/add', [
        '=chain=forward',
        `=src-address-list=${ADDRESS_LIST_MOROSOS}`,
        '=action=drop',
        `=comment=${DROP_COMMENT}`,
      ]);
      const addProrrogaRes = await writeApi.write('/ip/firewall/filter/add', [
        '=chain=forward',
        `=src-address-list=${ADDRESS_LIST_PRORROGA}`,
        '=action=accept',
        `=comment=${PRORROGA_COMMENT}`,
      ]);

      // Mover al inicio: drop → posición 0, prorroga → posición 1
      const dropId     = addDropRes?.[0]?.ret;
      const prorrogaId = addProrrogaRes?.[0]?.ret;
      if (dropId) {
        await writeApi.write('/ip/firewall/filter/move', [
          `=.id=${dropId}`, '=destination=0',
        ]).catch(() => {});
      }
      if (prorrogaId) {
        await writeApi.write('/ip/firewall/filter/move', [
          `=.id=${prorrogaId}`, '=destination=1',
        ]).catch(() => {});
      }

      this.logger.log(`Reglas de control (re)configuradas en ${creds.ip}`);
    } finally {
      writeApi.close().catch(() => {});
    }
  }

  async inyectarReglaBloqueoMorosos(creds: RouterCredentials): Promise<void> {
    await this.configurarReglasControl(creds);
  }

  // ────────────────────────────────────────────────────────────
  // DHCP STATIC BINDINGS — Amarre IP-MAC
  // ────────────────────────────────────────────────────────────

  // ── Crear/actualizar binding estático (upsert por MAC) ───────────────────
  // Usa pool.execute() (una sola conexión con retry) para leer y escribir.
  // No usa ?mac-address= como filtro en el print para evitar el bug UNKNOWNREPLY
  // de RouterOS v7: se obtienen todos los leases sin filtro y se busca en JS.
  async crearDhcpBinding(creds: RouterCredentials, binding: DhcpStaticBinding): Promise<string> {
    const macFormatted = binding.macAddress.toUpperCase()
      .replace(/[^A-F0-9]/g, '')
      .match(/.{2}/g)!.join(':');

    return this.pool.execute(creds, async (api) => {
      let existingId: string | null = null;
      try {
        const allLeases = await api.write('/ip/dhcp-server/lease/print');
        const match = allLeases.find(
          (l: any) => (l['mac-address'] || '').toUpperCase() === macFormatted,
        );
        existingId = match ? match['.id'] : null;
      } catch (err: any) {
        if (err?.errno !== 'UNKNOWNREPLY') throw err;
      }

      const leaseArgs = [
        `=address=${binding.ipAddress}`,
        `=mac-address=${macFormatted}`,
        ...(binding.server       ? [`=server=${binding.server}`]              : []),
        ...(binding.comment      ? [`=comment=${binding.comment}`]            : []),
        ...(binding.addressLists ? [`=address-lists=${binding.addressLists}`] : []),
      ];

      if (existingId) {
        await api.write('/ip/dhcp-server/lease/set', [`=.id=${existingId}`, ...leaseArgs]);
        this.logger.log(`DHCP binding actualizado: ${macFormatted} → ${binding.ipAddress} en ${creds.ip}`);
        return existingId;
      } else {
        const result = await api.write('/ip/dhcp-server/lease/add', leaseArgs);
        this.logger.log(`DHCP binding creado: ${macFormatted} → ${binding.ipAddress} en ${creds.ip}`);
        return result?.[0]?.ret || '';
      }
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
