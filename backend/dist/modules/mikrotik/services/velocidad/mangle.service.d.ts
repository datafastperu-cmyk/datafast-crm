import { RouterConnectionPool, RouterCredentials } from '../../services/connection-pool.service';
export interface ClienteMangle {
    clienteId: string;
    ip: string;
    connMarkDown: string;
    connMarkUp: string;
    packetMarkDown: string;
    packetMarkUp: string;
}
export interface MangleResult {
    reglasCreadas: number;
    reglasExistentes: number;
    marcas: ClienteMangle;
}
export declare class MangleService {
    private readonly pool;
    private readonly logger;
    private readonly PREFIX;
    constructor(pool: RouterConnectionPool);
    crearMangleCliente(creds: RouterCredentials, clienteId: string, ip: string, wanIface?: string): Promise<MangleResult>;
    eliminarMangleCliente(creds: RouterCredentials, clienteId: string): Promise<number>;
    actualizarIpMangle(creds: RouterCredentials, clienteId: string, ipNueva: string): Promise<void>;
    listarManglesFirebranet(creds: RouterCredentials): Promise<any[]>;
    setEstadoMangle(creds: RouterCredentials, clienteId: string, disabled: boolean): Promise<void>;
    generarNombresMarcas(clienteId: string): ClienteMangle;
    private agregarMangleSiNoExiste;
    private detectarWan;
}
