import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from '../../services/connection-pool.service';

// ─── Tipo de estrategia de queue ────────────────────────────
export enum EstrategiaQueue {
  SIMPLE_QUEUE  = 'simple_queue',   // Cola simple por IP — más rápido de configurar
  QUEUE_TREE    = 'queue_tree',     // Queue Tree individual — mayor control, prioridades
  PCQ_GLOBAL    = 'pcq_global',     // PCQ global por flujo — para WISP masivos
  SIN_LIMITE    = 'sin_limite',     // Sin limitación (planes especiales)
}

// ─── Configuración de velocidad para un cliente ───────────────
export interface ConfigVelocidad {
  estrategia:     EstrategiaQueue;
  downloadMbps:   number;
  uploadMbps:     number;
  burstDownMbps?: number;
  burstUpMbps?:   number;
  burstTiempoSeg?: number;
  prioridad:      number;           // 1 (mayor) - 8 (menor)
  nombreQueue:    string;           // Nombre de la queue en RouterOS
  targetIp:       string;           // IP del cliente
  // Burst threshold (al superar → velocidad normal)
  burstThreshDown?: number;
  burstThreshUp?:   number;
}

// ─── Capacidad del router (detectada automáticamente) ─────────
export interface CapacidadRouter {
  tieneSimpleQueue: boolean;
  tieneQueueTree:   boolean;
  tienePcq:         boolean;
  totalQueues:      number;
  sesionesActivas:  number;
  cpuLoad:          number;
  memoryUsePct:     number;
  versionRos:       string;
}

@Injectable()
export class VelocidadService {
  private readonly logger = new Logger(VelocidadService.name);

  constructor(private readonly pool: RouterConnectionPool) {}

  // ────────────────────────────────────────────────────────────
  // DETECTAR CAPACIDAD DEL ROUTER
  // Consulta el router y determina qué queue types están disponibles.
  // Se cachea por 60s para no consultar en cada provisión.
  // ────────────────────────────────────────────────────────────
  async detectarCapacidad(creds: RouterCredentials): Promise<CapacidadRouter> {
    return this.pool.execute(creds, async (api) => {
      const [
        queueTypes,
        simpleQueues,
        queueTrees,
        recursos,
        sesiones,
      ] = await Promise.all([
        api.write('/queue/type/print').catch(() => []),
        api.write('/queue/simple/print').catch(() => []),
        api.write('/queue/tree/print').catch(() => []),
        api.write('/system/resource/print').catch(() => [{}]),
        api.write('/ppp/active/print').catch(() => []),
      ]);

      const tienePcq = queueTypes.some(
        (t: any) => t.kind === 'pcq',
      );

      const res    = recursos[0] || {};
      const freeMem = parseInt(res['free-memory']  || '0', 10);
      const totMem  = parseInt(res['total-memory'] || '1', 10);

      return {
        tieneSimpleQueue: true,                    // siempre disponible
        tieneQueueTree:   true,                    // siempre disponible
        tienePcq,
        totalQueues:      simpleQueues.length + queueTrees.length,
        sesionesActivas:  sesiones.length,
        cpuLoad:          parseInt(res['cpu-load'] || '0', 10),
        memoryUsePct:     Math.round((1 - freeMem / totMem) * 100),
        versionRos:       res['version'] || '',
      };
    });
  }

  // ────────────────────────────────────────────────────────────
  // DECIDIR ESTRATEGIA DE QUEUE
  // Algoritmo de decisión basado en el plan, la capacidad del
  // router y la cantidad de clientes conectados.
  // ────────────────────────────────────────────────────────────
  decidirEstrategia(
    tipoQueuePlan: string,          // Configurado en el plan: 'simple_queue' | 'queue_tree' | 'pcq' | 'sin_limite'
    capacidad:     CapacidadRouter,
    totalClientes: number,          // Clientes ya en este router
  ): EstrategiaQueue {

    // ── Sin límite: plan dedicado/garantizado ────────────────
    if (tipoQueuePlan === 'sin_limite') {
      return EstrategiaQueue.SIN_LIMITE;
    }

    // ── PCQ solicitado en el plan ─────────────────────────────
    if (tipoQueuePlan === 'pcq') {
      // Usar PCQ si ya está configurado; de lo contrario, caer a Queue Tree
      return capacidad.tienePcq
        ? EstrategiaQueue.PCQ_GLOBAL
        : EstrategiaQueue.QUEUE_TREE;
    }

    // ── Queue Tree individual solicitado ──────────────────────
    if (tipoQueuePlan === 'queue_tree') {
      return EstrategiaQueue.QUEUE_TREE;
    }

    // ── Simple Queue (default) ────────────────────────────────
    // Si el router tiene mucha carga, advertir pero continuar
    if (capacidad.cpuLoad > 85) {
      this.logger.warn(
        `Router con CPU alta (${capacidad.cpuLoad}%) — simple queue puede afectar rendimiento`,
      );
    }

    return EstrategiaQueue.SIMPLE_QUEUE;
  }

  // ────────────────────────────────────────────────────────────
  // CONSTRUIR CONFIGURACIÓN COMPLETA
  // Genera el objeto ConfigVelocidad que usan los servicios de queue.
  // ────────────────────────────────────────────────────────────
  construirConfig(params: {
    nombreCliente:  string;    // usuario PPPoE o ID
    ipAsignada:     string;
    downloadMbps:   number;
    uploadMbps:     number;
    burstDownMbps?: number;
    burstUpMbps?:   number;
    burstTiempoSeg?: number;
    tipoPlan:       string;    // 'residencial' | 'empresarial' | 'dedicado'
    estrategia:     EstrategiaQueue;
  }): ConfigVelocidad {
    // Prioridad según tipo de plan
    const prioridades: Record<string, number> = {
      dedicado:    1,
      empresarial: 3,
      residencial: 5,
      prepago:     7,
    };
    const prioridad = prioridades[params.tipoPlan] ?? 5;

    // Burst threshold: 80% de la velocidad nominal por defecto
    const burstThreshDown = params.burstDownMbps
      ? Math.round(params.downloadMbps * 0.8)
      : undefined;
    const burstThreshUp = params.burstUpMbps
      ? Math.round(params.uploadMbps * 0.8)
      : undefined;

    return {
      estrategia:      params.estrategia,
      downloadMbps:    params.downloadMbps,
      uploadMbps:      params.uploadMbps,
      burstDownMbps:   params.burstDownMbps,
      burstUpMbps:     params.burstUpMbps,
      burstTiempoSeg:  params.burstTiempoSeg ?? 8,
      prioridad,
      nombreQueue:     params.nombreCliente,
      targetIp:        params.ipAsignada,
      burstThreshDown,
      burstThreshUp,
    };
  }

  // ────────────────────────────────────────────────────────────
  // VERIFICAR SI UN CLIENTE TIENE SU QUEUE CORRECTA
  // Compara la queue actual en el router con la velocidad del plan.
  // Retorna true si hay discrepancia (requiere actualización).
  // ────────────────────────────────────────────────────────────
  async necesitaActualizacion(
    creds:        RouterCredentials,
    nombreQueue:  string,
    downloadMbps: number,
    uploadMbps:   number,
  ): Promise<{ necesita: boolean; maxLimitActual?: string }> {
    return this.pool.execute(creds, async (api) => {
      const queues = await api.write('/queue/simple/print', [`?name=${nombreQueue}`]);
      if (!queues.length) {
        return { necesita: true }; // No existe → necesita crearse
      }

      const maxLimit: string = queues[0]['max-limit'] || '0/0';
      // Formato RouterOS: "uploadK/downloadK" o "uploadM/downloadM"
      const [upStr, downStr] = maxLimit.split('/');
      const upMbps   = this.parseMikrotikRate(upStr);
      const downMbps = this.parseMikrotikRate(downStr);

      const discrepancia = Math.abs(upMbps - uploadMbps) > 0.1
        || Math.abs(downMbps - downloadMbps) > 0.1;

      return { necesita: discrepancia, maxLimitActual: maxLimit };
    });
  }

  // ────────────────────────────────────────────────────────────
  // LISTAR QUEUES CON DISCREPANCIAS
  // Para la sincronización masiva: encuentra clientes cuya
  // velocidad en el router difiere de la del plan en el sistema.
  // ────────────────────────────────────────────────────────────
  async listarDiscrepancias(
    creds:     RouterCredentials,
    planesPorQueue: Map<string, { downloadMbps: number; uploadMbps: number }>,
  ): Promise<Array<{ nombre: string; actual: string; esperado: string }>> {
    const queues = await this.pool.execute(creds, (api) =>
      api.write('/queue/simple/print'),
    );

    const discrepancias: Array<{ nombre: string; actual: string; esperado: string }> = [];

    for (const queue of queues) {
      const plan = planesPorQueue.get(queue.name);
      if (!plan) continue;

      const maxLimit: string = queue['max-limit'] || '0/0';
      const [upStr, downStr] = maxLimit.split('/');
      const upMbps   = this.parseMikrotikRate(upStr);
      const downMbps = this.parseMikrotikRate(downStr);

      if (
        Math.abs(upMbps - plan.uploadMbps) > 0.1 ||
        Math.abs(downMbps - plan.downloadMbps) > 0.1
      ) {
        discrepancias.push({
          nombre:   queue.name,
          actual:   maxLimit,
          esperado: `${plan.uploadMbps}M/${plan.downloadMbps}M`,
        });
      }
    }

    return discrepancias;
  }

  // ── Parsear tasa de RouterOS: '30M' → 30, '512K' → 0.5 ────
  parseMikrotikRate(rateStr: string): number {
    if (!rateStr) return 0;
    const str = rateStr.trim().toUpperCase();
    if (str.endsWith('G'))  return parseFloat(str) * 1000;
    if (str.endsWith('M'))  return parseFloat(str);
    if (str.endsWith('K'))  return parseFloat(str) / 1000;
    return parseFloat(str) / 1_000_000; // bps
  }

  // ── Formatear Mbps a string RouterOS ─────────────────────
  formatearTasa(mbps: number): string {
    if (mbps >= 1000) return `${mbps / 1000}G`;
    if (mbps < 1)     return `${Math.round(mbps * 1000)}K`;
    return `${mbps}M`;
  }
}
