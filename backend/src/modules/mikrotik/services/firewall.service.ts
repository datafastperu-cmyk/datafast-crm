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
  private readonly _reglasLock = new Map<string, Promise<void>>();

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
  // Serializa llamadas concurrentes por router para evitar duplicados.
  async configurarReglasControl(creds: RouterCredentials): Promise<void> {
    const id   = creds.id;
    const prev = this._reglasLock.get(id) ?? Promise.resolve();
    const next = prev.then(() => this._doConfigurarReglasControl(creds));
    this._reglasLock.set(id, next.catch(() => {}));
    return next;
  }

  private async _doConfigurarReglasControl(creds: RouterCredentials): Promise<void> {
    const DROP_COMMENT     = 'Datafast-Bloquear Morosos';
    const PRORROGA_COMMENT = 'DATAFAST: Prorroga acceso completo';

    // Conexión 1: solo lectura. No usar filtros ?comment= (bug UNKNOWNREPLY en v7).
    // RouterOS v7 devuelve !empty cuando la cadena forward está completamente vacía.
    // node-routeros lanza RosException('UNKNOWNREPLY') DENTRO del callback del evento
    // 'data' del socket (fuera del Promise), por lo que el Promise de write() nunca
    // resuelve ni rechaza — queda colgado indefinidamente. El Promise.race con timeout
    // garantiza que siempre se continúa (resolviendo con [] si la cadena está vacía).
    let allRules: any[] = [];
    const readApi = await this.pool.connectDirect(creds);
    try {
      allRules = await Promise.race([
        readApi.write('/ip/firewall/filter/print'),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
      ]);
    } catch (err: any) {
      if (err?.errno !== 'UNKNOWNREPLY') throw err;
      this.logger.warn(`[Firewall] ${creds.ip} — UNKNOWNREPLY en filter/print; cadena vacía asumida`);
    } finally {
      await readApi.close().catch(() => {});
    }

    const dropIdx     = allRules.findIndex((r: any) => r.comment === DROP_COMMENT);
    const prorrogaIdx = allRules.findIndex((r: any) => r.comment === PRORROGA_COMMENT);
    const portalIdx   = allRules.findIndex((r: any) => r.comment === 'DATAFAST: Morosos portal pago');

    const dropRule     = dropIdx     >= 0 ? allRules[dropIdx]     : null;
    const prorrogaRule = prorrogaIdx >= 0 ? allRules[prorrogaIdx] : null;
    const portalRule   = portalIdx   >= 0 ? allRules[portalIdx]   : null;

    const allExist  = !!(dropRule && prorrogaRule);
    const orderOk   = allExist && dropIdx < prorrogaIdx;
    const dropClean = !dropRule?.['dst-address-list'];

    this.logger.log(
      `[Firewall] ${creds.ip} — reglas leídas: ${allRules.length} ` +
      `| drop=${dropIdx} prorroga=${prorrogaIdx} portal=${portalIdx} ` +
      `| allExist=${allExist} orderOk=${orderOk} dropClean=${dropClean}`,
    );

    if (allExist && orderOk && dropClean && !portalRule) {
      this.logger.warn(`[Firewall] Reglas ya correctas en ${creds.ip} — sin cambios`);
      return;
    }

    // Conexión 2: escritura en conexión fresca (la anterior puede haber quedado
    // con estado corrupto si devolvió UNKNOWNREPLY por cadena vacía).
    const writeApi = await this.pool.connectDirect(creds);
    try {
      // Eliminar TODAS las instancias con nuestros comentarios (no solo la primera)
      // para limpiar duplicados previos causados por llamadas concurrentes.
      const toRemove = allRules.filter((r: any) =>
        r.comment === DROP_COMMENT ||
        r.comment === PRORROGA_COMMENT ||
        r.comment === 'DATAFAST: Morosos portal pago',
      );
      for (const rule of toRemove) {
        await writeApi.write('/ip/firewall/filter/remove', [`=.id=${rule['.id']}`]);
      }

      // Añadir al final sin place-before: place-before=0 falla con "no such item"
      // cuando la cadena forward está vacía.
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

      const dropId     = addDropRes?.[0]?.ret;
      const prorrogaId = addProrrogaRes?.[0]?.ret;

      this.logger.log(`[Firewall] Add resultado en ${creds.ip} — dropId=${dropId ?? 'NULL'} prorrogaId=${prorrogaId ?? 'NULL'}`);

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
