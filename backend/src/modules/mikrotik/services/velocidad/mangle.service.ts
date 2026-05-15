import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from '../../services/connection-pool.service';

// ─── Marcas de tráfico por cliente ──────────────────────────
export interface ClienteMangle {
  clienteId:  string;
  ip:         string;
  // Nombres de las marcas generadas
  connMarkDown:   string;   // 'fn-cli-{id}-conn-down'
  connMarkUp:     string;   // 'fn-cli-{id}-conn-up'
  packetMarkDown: string;   // 'fn-cli-{id}-pkt-down'
  packetMarkUp:   string;   // 'fn-cli-{id}-pkt-up'
}

// ─── Resultado de configuración mangle ───────────────────────
export interface MangleResult {
  reglasCreadas:    number;
  reglasExistentes: number;
  marcas:           ClienteMangle;
}

@Injectable()
export class MangleService {
  private readonly logger = new Logger(MangleService.name);

  // Prefijo de todas las reglas de DATAFAST
  private readonly PREFIX = 'fn';

  constructor(private readonly pool: RouterConnectionPool) {}

  // ────────────────────────────────────────────────────────────
  // CREAR MANGLE RULES PARA UN CLIENTE INDIVIDUAL
  //
  // Crea 4 reglas por cliente:
  //   1. mark-connection  download (WAN → cliente)
  //   2. mark-packet      download
  //   3. mark-connection  upload   (cliente → WAN)
  //   4. mark-packet      upload
  //
  // Estas marcas son usadas por el Queue Tree individual.
  // Compatible con RouterOS v6 y v7.
  // ────────────────────────────────────────────────────────────
  async crearMangleCliente(
    creds:     RouterCredentials,
    clienteId: string,
    ip:        string,
    wanIface?: string,
  ): Promise<MangleResult> {
    const marcas = this.generarNombresMarcas(clienteId);

    return this.pool.execute(creds, async (api) => {
      // Detectar interface WAN si no se proporcionó
      const wan = wanIface || await this.detectarWan(api);

      let reglasCreadas    = 0;
      let reglasExistentes = 0;

      // ── 1. Connection mark DOWNLOAD (entrante desde WAN al cliente) ─
      const r1 = await this.agregarMangleSiNoExiste(api, {
        chain:          'forward',
        inInterface:    wan,
        dstAddress:     ip,
        action:         'mark-connection',
        newConnMark:    marcas.connMarkDown,
        passthrough:    'yes',
        comment:        `${this.PREFIX}:cli:${clienteId}:conn-down`,
      });
      r1 ? reglasCreadas++ : reglasExistentes++;

      // ── 2. Packet mark DOWNLOAD ──────────────────────────────
      const r2 = await this.agregarMangleSiNoExiste(api, {
        chain:          'forward',
        connMark:       marcas.connMarkDown,
        action:         'mark-packet',
        newPacketMark:  marcas.packetMarkDown,
        passthrough:    'no',
        comment:        `${this.PREFIX}:cli:${clienteId}:pkt-down`,
      });
      r2 ? reglasCreadas++ : reglasExistentes++;

      // ── 3. Connection mark UPLOAD (saliente del cliente hacia WAN) ─
      const r3 = await this.agregarMangleSiNoExiste(api, {
        chain:          'forward',
        outInterface:   wan,
        srcAddress:     ip,
        action:         'mark-connection',
        newConnMark:    marcas.connMarkUp,
        passthrough:    'yes',
        comment:        `${this.PREFIX}:cli:${clienteId}:conn-up`,
      });
      r3 ? reglasCreadas++ : reglasExistentes++;

      // ── 4. Packet mark UPLOAD ────────────────────────────────
      const r4 = await this.agregarMangleSiNoExiste(api, {
        chain:          'forward',
        connMark:       marcas.connMarkUp,
        action:         'mark-packet',
        newPacketMark:  marcas.packetMarkUp,
        passthrough:    'no',
        comment:        `${this.PREFIX}:cli:${clienteId}:pkt-up`,
      });
      r4 ? reglasCreadas++ : reglasExistentes++;

      if (reglasCreadas > 0) {
        this.logger.log(
          `Mangle cliente ${clienteId} (${ip}): ` +
          `${reglasCreadas} reglas creadas, ${reglasExistentes} ya existían en ${creds.ip}`,
        );
      }

      return { reglasCreadas, reglasExistentes, marcas };
    });
  }

  // ────────────────────────────────────────────────────────────
  // ELIMINAR MANGLE RULES DE UN CLIENTE
  // ────────────────────────────────────────────────────────────
  async eliminarMangleCliente(
    creds:     RouterCredentials,
    clienteId: string,
  ): Promise<number> {
    return this.pool.execute(creds, async (api) => {
      // Buscar todas las reglas con el prefijo del cliente
      const reglas = await api.write('/ip/firewall/mangle/print', [
        `?comment~${this.PREFIX}:cli:${clienteId}`,
      ]).catch(() => []);

      let eliminadas = 0;
      for (const regla of reglas) {
        await api.write('/ip/firewall/mangle/remove', [`=.id=${regla['.id']}`]);
        eliminadas++;
      }

      if (eliminadas > 0) {
        this.logger.log(`Mangle eliminado: ${eliminadas} reglas del cliente ${clienteId} en ${creds.ip}`);
      }

      return eliminadas;
    });
  }

  // ────────────────────────────────────────────────────────────
  // ACTUALIZAR IP EN MANGLE (cuando cambia la IP del cliente)
  // ────────────────────────────────────────────────────────────
  async actualizarIpMangle(
    creds:     RouterCredentials,
    clienteId: string,
    ipNueva:   string,
  ): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      // Actualizar regla de destino (download)
      const downConn = await api.write('/ip/firewall/mangle/print', [
        `?comment=${this.PREFIX}:cli:${clienteId}:conn-down`,
      ]).catch(() => []);

      for (const r of downConn) {
        await api.write('/ip/firewall/mangle/set', [
          `=.id=${r['.id']}`,
          `=dst-address=${ipNueva}`,
        ]);
      }

      // Actualizar regla de origen (upload)
      const upConn = await api.write('/ip/firewall/mangle/print', [
        `?comment=${this.PREFIX}:cli:${clienteId}:conn-up`,
      ]).catch(() => []);

      for (const r of upConn) {
        await api.write('/ip/firewall/mangle/set', [
          `=.id=${r['.id']}`,
          `=src-address=${ipNueva}`,
        ]);
      }

      this.logger.log(`Mangle IP actualizada: cliente ${clienteId} → ${ipNueva} en ${creds.ip}`);
    });
  }

  // ────────────────────────────────────────────────────────────
  // LISTAR TODOS LOS MANGLES DE DATAFAST
  // ────────────────────────────────────────────────────────────
  async listarManglesFirebranet(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, async (api) => {
      const todas = await api.write('/ip/firewall/mangle/print');
      return todas.filter((r: any) =>
        r.comment?.startsWith(this.PREFIX + ':cli:'),
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // HABILITAR / DESHABILITAR MANGLE DE UN CLIENTE
  // Útil para suspensión sin eliminar las reglas.
  // ────────────────────────────────────────────────────────────
  async setEstadoMangle(
    creds:     RouterCredentials,
    clienteId: string,
    disabled:  boolean,
  ): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const reglas = await api.write('/ip/firewall/mangle/print', [
        `?comment~${this.PREFIX}:cli:${clienteId}`,
      ]).catch(() => []);

      for (const r of reglas) {
        await api.write('/ip/firewall/mangle/set', [
          `=.id=${r['.id']}`,
          `=disabled=${disabled ? 'yes' : 'no'}`,
        ]);
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ────────────────────────────────────────────────────────────

  // Generar nombres únicos de marcas para un cliente
  generarNombresMarcas(clienteId: string): ClienteMangle {
    // Usar los primeros 8 chars del UUID sin guiones para no exceder límite de nombre
    const shortId = clienteId.replace(/-/g, '').substring(0, 12);
    return {
      clienteId,
      ip:             '',  // se llena al crear
      connMarkDown:   `${this.PREFIX}-${shortId}-cd`,
      connMarkUp:     `${this.PREFIX}-${shortId}-cu`,
      packetMarkDown: `${this.PREFIX}-${shortId}-pd`,
      packetMarkUp:   `${this.PREFIX}-${shortId}-pu`,
    };
  }

  // Agregar regla mangle solo si no existe (idempotente)
  private async agregarMangleSiNoExiste(
    api:    any,
    params: {
      chain:          string;
      inInterface?:   string;
      outInterface?:  string;
      srcAddress?:    string;
      dstAddress?:    string;
      connMark?:      string;
      action:         string;
      newConnMark?:   string;
      newPacketMark?: string;
      passthrough:    string;
      comment:        string;
    },
  ): Promise<boolean> {
    const existing = await api.write('/ip/firewall/mangle/print', [
      `?comment=${params.comment}`,
    ]).catch(() => []);

    if (existing.length > 0) return false; // ya existe

    const args: string[] = [
      `=chain=${params.chain}`,
      `=action=${params.action}`,
      `=passthrough=${params.passthrough}`,
      `=comment=${params.comment}`,
    ];

    if (params.inInterface)  args.push(`=in-interface=${params.inInterface}`);
    if (params.outInterface) args.push(`=out-interface=${params.outInterface}`);
    if (params.srcAddress)   args.push(`=src-address=${params.srcAddress}`);
    if (params.dstAddress)   args.push(`=dst-address=${params.dstAddress}`);
    if (params.connMark)     args.push(`=connection-mark=${params.connMark}`);
    if (params.newConnMark)  args.push(`=new-connection-mark=${params.newConnMark}`);
    if (params.newPacketMark) args.push(`=new-packet-mark=${params.newPacketMark}`);

    await api.write('/ip/firewall/mangle/add', args);
    return true; // recién creada
  }

  // Detectar interface WAN automáticamente
  private async detectarWan(api: any): Promise<string> {
    try {
      const routes = await api.write('/ip/route/print', [
        '?dst-address=0.0.0.0/0', '?!disabled',
      ]);
      if (routes.length && routes[0].gateway) {
        const arp = await api.write('/ip/arp/print', [
          `?address=${routes[0].gateway}`,
        ]);
        if (arp.length && arp[0].interface) return arp[0].interface;
      }
    } catch { /* fallback */ }

    // Buscar interfaz con nombre WAN
    const ifaces = await api.write('/interface/print', ['?!disabled']).catch(() => []);
    const wan = ifaces.find((i: any) => /wan|internet|ether1|uplink/i.test(i.name || ''));
    return wan?.name || 'ether1';
  }
}
