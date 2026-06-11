import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

export interface QueueParams {
  name:            string;
  target:          string;     // IP o rango CIDR: '192.168.1.2' o '192.168.1.2/32'
  maxLimitDown:    number;     // Mbps bajada
  maxLimitUp:      number;     // Mbps subida
  burstLimitDown?: number;     // Mbps burst bajada
  burstLimitUp?:   number;     // Mbps burst subida
  burstTimeDown?:  number;     // segundos burst
  burstTimeUp?:    number;
  burstThreshDown?: number;    // Mbps umbral burst bajada
  burstThreshUp?:  number;
  parent?:         string;     // nombre del queue padre (para Queue Tree)
  comment?:        string;
  priority?:       number;     // 1-8 (1=mayor prioridad)
}

export interface PcqSetup {
  namePrefix:   string;
  downloadMbps: number;
  uploadMbps:   number;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(private readonly pool: RouterConnectionPool) {}

  // ────────────────────────────────────────────────────────────
  // SIMPLE QUEUES
  // Método más simple: cola por IP de destino
  // ────────────────────────────────────────────────────────────

  async crearSimpleQueue(creds: RouterCredentials, params: QueueParams): Promise<string> {
    return this.pool.execute(creds, async (api) => {
      const existing = await api.write('/queue/simple/print', [`?name=${params.name}`]);

      const target  = params.target.includes('/') ? params.target : `${params.target}/32`;
      const maxLimit = `${params.maxLimitUp}M/${params.maxLimitDown}M`;

      // Burst string: "burstLimit/burstThresh/burstTime" (subida/bajada separados por espacio)
      const burstArgs: string[] = [];
      if (params.burstLimitDown && params.burstLimitUp) {
        burstArgs.push(`=burst-limit=${params.burstLimitUp}M/${params.burstLimitDown}M`);
        burstArgs.push(`=burst-threshold=${params.burstThreshUp || params.maxLimitUp}M/${params.burstThreshDown || params.maxLimitDown}M`);
        burstArgs.push(`=burst-time=${params.burstTimeUp || 8}/${params.burstTimeDown || 8}`);
      }

      if (existing.length > 0) {
        await api.write('/queue/simple/set', [
          `=.id=${existing[0]['.id']}`,
          `=target=${target}`,
          `=max-limit=${maxLimit}`,
          ...burstArgs,
          ...(params.comment ? [`=comment=${params.comment}`] : []),
        ]);
        this.logger.log(`Simple Queue actualizada: ${params.name} | ${maxLimit}`);
        return existing[0]['.id'];
      }

      const result = await api.write('/queue/simple/add', [
        `=name=${params.name}`,
        `=target=${target}`,
        `=max-limit=${maxLimit}`,
        `=queue=default-small/default-small`,
        ...burstArgs,
        ...(params.comment ? [`=comment=${params.comment}`] : []),
      ]);

      this.logger.log(`Simple Queue creada: ${params.name} | ${maxLimit} | target: ${target}`);
      return result?.[0]?.ret || '';
    });
  }

  async eliminarSimpleQueue(creds: RouterCredentials, name: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const queues = await api.write('/queue/simple/print', [`?name=${name}`]);
      if (queues.length === 0) return;
      await api.write('/queue/simple/remove', [`=.id=${queues[0]['.id']}`]);
      this.logger.log(`Simple Queue eliminada: ${name} en ${creds.ip}`);
    });
  }

  async listarSimpleQueues(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, (api) => api.write('/queue/simple/print'));
  }

  // Solo actualiza max-limit de una queue existente sin tocar su target ni otros campos
  async actualizarVelocidadQueue(
    creds:        RouterCredentials,
    name:         string,
    downloadMbps: number,
    uploadMbps:   number,
  ): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const existing = await api.write('/queue/simple/print', [`?name=${name}`]);
      if (existing.length === 0) {
        this.logger.warn(`Simple Queue no encontrada: ${name} en ${creds.ip} — velocidad no actualizada`);
        return;
      }
      const maxLimit = `${uploadMbps}M/${downloadMbps}M`;
      await api.write('/queue/simple/set', [
        `=.id=${existing[0]['.id']}`,
        `=max-limit=${maxLimit}`,
      ]);
      this.logger.log(`Velocidad actualizada en queue: ${name} | ${maxLimit}`);
    });
  }

  // ────────────────────────────────────────────────────────────
  // PCQ + QUEUE TREE
  // Método avanzado para gestión de ancho de banda por grupos.
  // Soportado en v6 y v7, diferente sintaxis menor.
  // ────────────────────────────────────────────────────────────

  /**
   * Verificar si el router tiene PCQ configurado.
   * Si no tiene, el sistema lo crea automáticamente.
   */
  async tienePcqConfigurado(creds: RouterCredentials): Promise<boolean> {
    const types = await this.pool.execute(creds, (api) =>
      api.write('/queue/type/print', ['?kind=pcq']),
    );
    return types.length >= 2; // Al menos pcq-download y pcq-upload
  }

  /**
   * Configurar PCQ completo desde cero:
   * 1. Queue Types (PCQ download/upload)
   * 2. Mangle rules (marcado de paquetes por IP del cliente)
   * 3. Queue Tree padre con límite total
   * 4. Queue Tree hijos (download/upload) usando PCQ
   *
   * Soporta RouterOS v6 y v7.
   */
  async configurarPcqCompleto(
    creds:        RouterCredentials,
    params:       PcqSetup,
  ): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const isV7 = creds.version === 'v7';

      // ── 1. Queue Types PCQ ─────────────────────────────────
      await this.crearQueueTypePcq(api, `${params.namePrefix}-pcq-down`, 'download', isV7);
      await this.crearQueueTypePcq(api, `${params.namePrefix}-pcq-up`,   'upload',   isV7);

      // ── 2. Interface padre (WAN — ajustar según el router) ─
      const wanIface = await this.detectarInterfaceWan(api);

      // ── 3. Mangle rules ────────────────────────────────────
      await this.crearMangleRules(api, params.namePrefix, wanIface, isV7);

      // ── 4. Queue Tree padre ────────────────────────────────
      await this.crearQueueTree(api, params.namePrefix, params.downloadMbps, params.uploadMbps, wanIface, isV7);

      this.logger.log(
        `PCQ configurado: ${params.namePrefix} | ` +
        `${params.downloadMbps}/${params.uploadMbps} Mbps | ${creds.ip}`,
      );
    });
  }

  private async crearQueueTypePcq(
    api:  any,
    name: string,
    flow: 'download' | 'upload',
    isV7: boolean,
  ): Promise<void> {
    const existing = await api.write('/queue/type/print', [`?name=${name}`]);
    if (existing.length > 0) return;

    // En v7 el parámetro 'kind' sigue siendo 'pcq' pero cambia 'pcq-classifier'
    const classifier = flow === 'download' ? 'dst-address' : 'src-address';

    await api.write('/queue/type/add', [
      `=name=${name}`,
      `=kind=pcq`,
      `=pcq-classifier=${classifier}`,
      `=pcq-rate=0`,        // sin límite por flujo (limitamos en Queue Tree)
      `=pcq-limit=50KiB`,
      `=pcq-total-limit=2000KiB`,
      ...(isV7 ? [`=pcq-dst-address-mask=32`, `=pcq-src-address-mask=32`] : []),
    ]);
  }

  private async crearMangleRules(
    api:        any,
    prefix:     string,
    wanIface:   string,
    isV7:       boolean,
  ): Promise<void> {
    // ── Mark connections (download: WAN→LAN, upload: LAN→WAN) ─
    const rules = [
      // Download: tráfico entrante desde WAN marcando conexión
      {
        chain: 'forward', in: wanIface,
        action: 'mark-connection',
        newConn: `${prefix}-conn-down`,
        comment: `${prefix} - mark download connection`,
      },
      // Download: marcar paquetes de esa conexión
      {
        chain: 'forward', in: wanIface,
        action: 'mark-packet',
        connMark: `${prefix}-conn-down`,
        newMark: `${prefix}-pkt-down`,
        comment: `${prefix} - mark download packets`,
      },
      // Upload: tráfico saliente hacia WAN
      {
        chain: 'forward', out: wanIface,
        action: 'mark-connection',
        newConn: `${prefix}-conn-up`,
        comment: `${prefix} - mark upload connection`,
      },
      {
        chain: 'forward', out: wanIface,
        action: 'mark-packet',
        connMark: `${prefix}-conn-up`,
        newMark: `${prefix}-pkt-up`,
        comment: `${prefix} - mark upload packets`,
      },
    ];

    for (const r of rules) {
      const checkArgs: string[] = [`?comment=${r.comment}`];
      const existing = await api.write('/ip/firewall/mangle/print', checkArgs);
      if (existing.length > 0) continue;

      const args: string[] = [
        `=chain=${r.chain}`,
        ...(r.in  ? [`=in-interface=${r.in}`]  : []),
        ...(r.out ? [`=out-interface=${r.out}`] : []),
        `=action=${r.action}`,
        ...(r.newConn   ? [`=new-connection-mark=${r.newConn}`,   `=passthrough=yes`]  : []),
        ...(r.connMark  ? [`=connection-mark=${r.connMark}`]                            : []),
        ...(r.newMark   ? [`=new-packet-mark=${r.newMark}`,       `=passthrough=no`]   : []),
        `=comment=${r.comment}`,
      ];

      await api.write('/ip/firewall/mangle/add', args);
    }
  }

  private async crearQueueTree(
    api:          any,
    prefix:       string,
    downloadMbps: number,
    uploadMbps:   number,
    wanIface:     string,
    isV7:         boolean,
  ): Promise<void> {
    // Queue padre global
    const padreExisting = await api.write('/queue/tree/print', [`?name=${prefix}-global`]);
    if (padreExisting.length === 0) {
      await api.write('/queue/tree/add', [
        `=name=${prefix}-global`,
        `=parent=global`,
        `=max-limit=${Math.max(downloadMbps, uploadMbps)}M`,
        `=queue=default`,
        `=comment=${prefix} - global queue tree`,
      ]);
    }

    // Queue hijo download
    const dlExisting = await api.write('/queue/tree/print', [`?name=${prefix}-download`]);
    if (dlExisting.length === 0) {
      await api.write('/queue/tree/add', [
        `=name=${prefix}-download`,
        `=parent=${prefix}-global`,
        `=packet-mark=${prefix}-pkt-down`,
        `=max-limit=${downloadMbps}M`,
        `=queue=${prefix}-pcq-down`,
        `=comment=${prefix} - PCQ download`,
      ]);
    }

    // Queue hijo upload
    const ulExisting = await api.write('/queue/tree/print', [`?name=${prefix}-upload`]);
    if (ulExisting.length === 0) {
      await api.write('/queue/tree/add', [
        `=name=${prefix}-upload`,
        `=parent=${prefix}-global`,
        `=packet-mark=${prefix}-pkt-up`,
        `=max-limit=${uploadMbps}M`,
        `=queue=${prefix}-pcq-up`,
        `=comment=${prefix} - PCQ upload`,
      ]);
    }
  }

  private async detectarInterfaceWan(api: any): Promise<string> {
    // Buscar la interface con la ruta por defecto
    try {
      const routes = await api.write('/ip/route/print', ['?dst-address=0.0.0.0/0', '?!disabled']);
      if (routes.length > 0 && routes[0]['gateway']) {
        const gateway  = routes[0]['gateway'];
        const neigh    = await api.write('/ip/arp/print', [`?address=${gateway}`]);
        if (neigh.length > 0 && neigh[0]['interface']) {
          return neigh[0]['interface'];
        }
      }
    } catch { /* fallback */ }

    // Fallback: buscar interface con tipo 'ether' y nombre WAN
    const ifaces = await api.write('/interface/print', ['?type=ether', '?!disabled']);
    const wan    = ifaces.find((i: any) =>
      /wan|internet|ether1|uplink/i.test(i.name || ''),
    );
    return wan?.name || 'ether1';
  }

  // ── Actualizar límite de una Simple Queue existente ────────
  async actualizarLimiteQueue(
    creds:        RouterCredentials,
    name:         string,
    downloadMbps: number,
    uploadMbps:   number,
  ): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const queues = await api.write('/queue/simple/print', [`?name=${name}`]);
      if (queues.length === 0) {
        this.logger.warn(`Queue ${name} no existe en ${creds.ip}`);
        return;
      }
      await api.write('/queue/simple/set', [
        `=.id=${queues[0]['.id']}`,
        `=max-limit=${uploadMbps}M/${downloadMbps}M`,
      ]);
      this.logger.log(`Queue actualizada: ${name} | ${uploadMbps}/${downloadMbps} Mbps`);
    });
  }

  // ── Estadísticas de una queue ──────────────────────────────
  async getEstadisticasQueue(creds: RouterCredentials, name: string): Promise<{
    bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number;
  } | null> {
    const queues = await this.pool.execute(creds, (api) =>
      api.write('/queue/simple/print', [`?name=${name}`]),
    );
    if (!queues.length) return null;
    const q = queues[0];
    return {
      bytesIn:    parseInt(q['bytes'] || '0/0', 10) || 0,
      bytesOut:   0,
      packetsIn:  parseInt(q['packets'] || '0/0', 10) || 0,
      packetsOut: 0,
    };
  }
}
