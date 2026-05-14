import { RouterConnectionPool, RouterCredentials } from '../../services/connection-pool.service';
export declare enum EstrategiaQueue {
    SIMPLE_QUEUE = "simple_queue",
    QUEUE_TREE = "queue_tree",
    PCQ_GLOBAL = "pcq_global",
    SIN_LIMITE = "sin_limite"
}
export interface ConfigVelocidad {
    estrategia: EstrategiaQueue;
    downloadMbps: number;
    uploadMbps: number;
    burstDownMbps?: number;
    burstUpMbps?: number;
    burstTiempoSeg?: number;
    prioridad: number;
    nombreQueue: string;
    targetIp: string;
    burstThreshDown?: number;
    burstThreshUp?: number;
}
export interface CapacidadRouter {
    tieneSimpleQueue: boolean;
    tieneQueueTree: boolean;
    tienePcq: boolean;
    totalQueues: number;
    sesionesActivas: number;
    cpuLoad: number;
    memoryUsePct: number;
    versionRos: string;
}
export declare class VelocidadService {
    private readonly pool;
    private readonly logger;
    constructor(pool: RouterConnectionPool);
    detectarCapacidad(creds: RouterCredentials): Promise<CapacidadRouter>;
    decidirEstrategia(tipoQueuePlan: string, capacidad: CapacidadRouter, totalClientes: number): EstrategiaQueue;
    construirConfig(params: {
        nombreCliente: string;
        ipAsignada: string;
        downloadMbps: number;
        uploadMbps: number;
        burstDownMbps?: number;
        burstUpMbps?: number;
        burstTiempoSeg?: number;
        tipoPlan: string;
        estrategia: EstrategiaQueue;
    }): ConfigVelocidad;
    necesitaActualizacion(creds: RouterCredentials, nombreQueue: string, downloadMbps: number, uploadMbps: number): Promise<{
        necesita: boolean;
        maxLimitActual?: string;
    }>;
    listarDiscrepancias(creds: RouterCredentials, planesPorQueue: Map<string, {
        downloadMbps: number;
        uploadMbps: number;
    }>): Promise<Array<{
        nombre: string;
        actual: string;
        esperado: string;
    }>>;
    parseMikrotikRate(rateStr: string): number;
    formatearTasa(mbps: number): string;
}
