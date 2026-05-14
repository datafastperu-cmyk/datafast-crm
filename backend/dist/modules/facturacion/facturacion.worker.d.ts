import { Job } from 'bull';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { FacturacionService } from './facturacion.service';
export declare const FACTURACION_QUEUE = "facturacion";
export interface GenerarMensualPayload {
    empresaId: string;
    usuarioId: string;
    mes: number;
    anio: number;
}
export declare class FacturacionScheduler {
    private readonly queue;
    private readonly ds;
    private readonly logger;
    constructor(queue: Queue, ds: DataSource);
    scheduleDailyJobs(): Promise<void>;
}
export declare class FacturacionWorker {
    private readonly facturacionSvc;
    private readonly ds;
    private readonly logger;
    constructor(facturacionSvc: FacturacionService, ds: DataSource);
    processMarcarVencidas(job: Job): Promise<{
        marcadas: number;
    }>;
    processGenerarMensual(job: Job<GenerarMensualPayload>): Promise<import("./facturacion.service").ResultadoGeneracion>;
    onFailed(job: Job, error: Error): void;
    onCompleted(job: Job, result: any): void;
}
