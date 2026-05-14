import { Job, Queue } from 'bull';
import { Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { PingService } from './services/ping.service';
import { SnmpService } from './services/snmp.service';
import { AlertasService } from './services/alertas.service';
import { MonitoreoGateway } from './gateways/monitoreo.gateway';
import { Nodo, MedicionNodo, EstadoNodo } from './entities/monitoreo.entity';
export declare const MONITOREO_QUEUE = "monitoreo";
export declare const JOB_PING_NODO = "ping-nodo";
export declare const JOB_SNMP_NODO = "snmp-nodo";
export declare const JOB_PING_BATCH = "ping-batch";
export declare const JOB_DASHBOARD = "broadcast-dashboard";
export declare class MonitoreoScheduler {
    private readonly queue;
    private readonly nodoRepo;
    private readonly logger;
    constructor(queue: Queue, nodoRepo: Repository<Nodo>);
    schedulePing(): Promise<void>;
    scheduleSnmp(): Promise<void>;
    scheduleDashboard(): Promise<void>;
}
export declare class MonitoreoWorker {
    private readonly pingSvc;
    private readonly snmpSvc;
    private readonly alertasSvc;
    private readonly gateway;
    private readonly nodoRepo;
    private readonly medicionRepo;
    private readonly ds;
    private readonly logger;
    constructor(pingSvc: PingService, snmpSvc: SnmpService, alertasSvc: AlertasService, gateway: MonitoreoGateway, nodoRepo: Repository<Nodo>, medicionRepo: Repository<MedicionNodo>, ds: DataSource);
    processPingBatch(job: Job<{
        empresaId: string;
        nodos: Array<{
            id: string;
            ip: string;
            nombre: string;
            tipo: string;
            pingTimeoutMs: number;
            pingReintentos: number;
            estadoActual: EstadoNodo;
            alertasHabilitadas: boolean;
        }>;
    }>): Promise<void>;
    private procesarResultadoPing;
    processSnmpNodo(job: Job<{
        nodoId: string;
        empresaId: string;
        nombre: string;
        ip: string;
        community: string;
        version: number;
        ifIndex: number;
        alertasHabilitadas: boolean;
    }>): Promise<void>;
    processDashboard(_job: Job): Promise<void>;
    onFailed(job: Job, error: Error): void;
}
