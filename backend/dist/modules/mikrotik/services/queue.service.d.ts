import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';
export interface QueueParams {
    name: string;
    target: string;
    maxLimitDown: number;
    maxLimitUp: number;
    burstLimitDown?: number;
    burstLimitUp?: number;
    burstTimeDown?: number;
    burstTimeUp?: number;
    burstThreshDown?: number;
    burstThreshUp?: number;
    parent?: string;
    comment?: string;
    priority?: number;
}
export interface PcqSetup {
    namePrefix: string;
    downloadMbps: number;
    uploadMbps: number;
}
export declare class QueueService {
    private readonly pool;
    private readonly logger;
    constructor(pool: RouterConnectionPool);
    crearSimpleQueue(creds: RouterCredentials, params: QueueParams): Promise<string>;
    eliminarSimpleQueue(creds: RouterCredentials, name: string): Promise<void>;
    listarSimpleQueues(creds: RouterCredentials): Promise<any[]>;
    tienePcqConfigurado(creds: RouterCredentials): Promise<boolean>;
    configurarPcqCompleto(creds: RouterCredentials, params: PcqSetup): Promise<void>;
    private crearQueueTypePcq;
    private crearMangleRules;
    private crearQueueTree;
    private detectarInterfaceWan;
    actualizarLimiteQueue(creds: RouterCredentials, name: string, downloadMbps: number, uploadMbps: number): Promise<void>;
    getEstadisticasQueue(creds: RouterCredentials, name: string): Promise<{
        bytesIn: number;
        bytesOut: number;
        packetsIn: number;
        packetsOut: number;
    } | null>;
}
