import { DataSource } from 'typeorm';
import { RouterConnectionPool, RouterCredentials } from '../../services/connection-pool.service';
import { VelocidadService, EstrategiaQueue } from './velocidad.service';
import { MangleService } from './mangle.service';
import { QueueTreeClienteService } from './queue-tree-cliente.service';
import { QueueService } from '../../services/queue.service';
export interface AplicarVelocidadParams {
    routerCreds: RouterCredentials;
    clienteId: string;
    usuarioPppoe: string;
    ipAsignada: string;
    downloadMbps: number;
    uploadMbps: number;
    burstDownMbps?: number;
    burstUpMbps?: number;
    burstTiempoSeg?: number;
    tipoQueuePlan: string;
    tipoPlan: string;
    wanIface?: string;
}
export interface ResultadoVelocidad {
    estrategia: EstrategiaQueue;
    nombreQueue?: string;
    reglasCreadas: number;
    exitoso: boolean;
    detalle: string;
}
export interface ResultadoSincronizacion {
    routerId: string;
    procesados: number;
    actualizados: number;
    errores: number;
    detalles: Array<{
        clienteId: string;
        resultado: string;
        error?: string;
    }>;
}
export declare class VelocidadOrquestador {
    private readonly pool;
    private readonly velocidadSvc;
    private readonly mangleSvc;
    private readonly qtClienteSvc;
    private readonly queueSvc;
    private readonly ds;
    private readonly logger;
    constructor(pool: RouterConnectionPool, velocidadSvc: VelocidadService, mangleSvc: MangleService, qtClienteSvc: QueueTreeClienteService, queueSvc: QueueService, ds: DataSource);
    aplicarVelocidad(params: AplicarVelocidadParams): Promise<ResultadoVelocidad>;
    cambiarVelocidadPlan(creds: RouterCredentials, clienteId: string, usuarioPppoe: string, downloadMbps: number, uploadMbps: number, prioridad?: number): Promise<{
        actualizado: boolean;
        metodo: string;
        detalle: string;
    }>;
    sincronizarVelocidades(creds: RouterCredentials, routerId: string): Promise<ResultadoSincronizacion>;
    eliminarVelocidadCliente(creds: RouterCredentials, clienteId: string, usuarioPppoe: string): Promise<void>;
}
