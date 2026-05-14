import { Job, Queue } from 'bull';
import { Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { VelocidadOrquestador } from './services/velocidad/velocidad-orquestador.service';
import { Router } from './entities/router.entity';
import { RouterConnectionPool } from './services/connection-pool.service';
export declare const VELOCIDAD_QUEUE = "velocidad-sync";
export interface SyncVelocidadPayload {
    routerId: string;
    empresaId: string;
}
export interface CambioVelocidadPayload {
    routerId: string;
    empresaId: string;
    clienteId: string;
    usuarioPppoe: string;
    downloadMbps: number;
    uploadMbps: number;
    prioridad?: number;
}
export declare class VelocidadScheduler {
    private readonly queue;
    private readonly routerRepo;
    private readonly ds;
    private readonly logger;
    constructor(queue: Queue, routerRepo: Repository<Router>, ds: DataSource);
    scheduleSync(): Promise<void>;
    enqueueVelocidadChange(payload: CambioVelocidadPayload): Promise<void>;
}
export declare class VelocidadWorker {
    private readonly orquestador;
    private readonly pool;
    private readonly routerRepo;
    private readonly logger;
    constructor(orquestador: VelocidadOrquestador, pool: RouterConnectionPool, routerRepo: Repository<Router>);
    processSincronizarRouter(job: Job<SyncVelocidadPayload>): Promise<import("./services/velocidad/velocidad-orquestador.service").ResultadoSincronizacion | {
        omitido: boolean;
    }>;
    processCambiarVelocidad(job: Job<CambioVelocidadPayload>): Promise<{
        actualizado: boolean;
        metodo: string;
        detalle: string;
    } | {
        omitido: boolean;
    }>;
    onFailed(job: Job, error: Error): void;
    onCompleted(job: Job): void;
}
