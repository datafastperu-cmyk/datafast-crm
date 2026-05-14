import { Job, Queue } from 'bull';
import { DataSource } from 'typeorm';
import { EventEmitter } from '@nestjs/event-emitter';
import { FacturacionService } from '../facturacion/facturacion.service';
import { WhatsAppService } from '../notificaciones/services/whatsapp.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { PayloadGenerarFacturasEmpresa, PayloadGenerarFacturaContrato } from './workers.constants';
interface ResultadoGeneracion {
    empresaId: string;
    mes: number;
    anio: number;
    total: number;
    exitosas: number;
    omitidas: number;
    errores: number;
    montoTotal: number;
    detalles: Array<{
        contratoId: string;
        resultado: string;
        error?: string;
    }>;
}
export declare class FacturacionScheduler {
    private readonly queue;
    private readonly ds;
    private readonly logger;
    constructor(queue: Queue, ds: DataSource);
    scheduleFacturacionDiaria(): Promise<void>;
    enqueueGeneracionManual(empresaId: string, mes: number, anio: number, forzar?: boolean): Promise<string>;
    getEstadoCola(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    }>;
}
export declare class FacturacionWorker {
    private readonly facturacionSvc;
    private readonly whatsappSvc;
    private readonly auditoria;
    private readonly events;
    private readonly ds;
    private readonly logger;
    constructor(facturacionSvc: FacturacionService, whatsappSvc: WhatsAppService, auditoria: AuditoriaService, events: EventEmitter, ds: DataSource);
    processGenerarFacturasEmpresa(job: Job<PayloadGenerarFacturasEmpresa>): Promise<ResultadoGeneracion>;
    processMarcarVencidas(job: Job<{
        fecha: string;
    }>): Promise<{
        marcadas: number;
    }>;
    processGenerarFacturaIndividual(job: Job<PayloadGenerarFacturaContrato>): Promise<any>;
    onFailed(job: Job, error: Error): void;
    onCompleted(job: Job, result: any): void;
    private ultimoDiaMes;
    private mesNombre;
}
export {};
