import { RouterConnectionPool, RouterCredentials } from '../../services/connection-pool.service';
import { MangleService } from './mangle.service';
import { ConfigVelocidad } from './velocidad.service';
export interface NombresQueueTree {
    padre: string;
    download: string;
    upload: string;
}
export declare class QueueTreeClienteService {
    private readonly pool;
    private readonly mangleSvc;
    private readonly logger;
    private readonly PREFIX;
    constructor(pool: RouterConnectionPool, mangleSvc: MangleService);
    crearQueueTreeCliente(creds: RouterCredentials, clienteId: string, config: ConfigVelocidad, wanIface?: string): Promise<{
        nombres: NombresQueueTree;
        reglasCreadas: number;
    }>;
    actualizarVelocidad(creds: RouterCredentials, clienteId: string, downloadMbps: number, uploadMbps: number, prioridad?: number): Promise<{
        actualizado: boolean;
        metodo: string;
    }>;
    private actualizarQueueTree;
    private actualizarSimpleQueue;
    eliminarQueueTreeCliente(creds: RouterCredentials, clienteId: string): Promise<void>;
    private asegurarQueuesPadreGlobales;
    generarNombres(clienteId: string): NombresQueueTree;
    listarQueueTreesFibranet(creds: RouterCredentials): Promise<any[]>;
}
