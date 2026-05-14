import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';
export declare const ADDRESS_LIST_MOROSOS = "morosos";
export declare const ADDRESS_LIST_PRORROGA = "prorroga";
export declare const ADDRESS_LIST_PORTAL = "portal-pago";
export interface DhcpStaticBinding {
    macAddress: string;
    ipAddress: string;
    hostname?: string;
    comment?: string;
    server?: string;
}
export declare class FirewallService {
    private readonly pool;
    private readonly logger;
    constructor(pool: RouterConnectionPool);
    suspenderCliente(creds: RouterCredentials, ip: string, clienteId: string, comment?: string): Promise<void>;
    reactivarCliente(creds: RouterCredentials, ip: string): Promise<void>;
    estaEnListaMorosos(creds: RouterCredentials, ip: string): Promise<boolean>;
    listarMorosos(creds: RouterCredentials): Promise<Array<{
        ip: string;
        comment: string;
        addedAt: string;
    }>>;
    aplicarProrroga(creds: RouterCredentials, ip: string, comment?: string): Promise<void>;
    configurarReglasControl(creds: RouterCredentials): Promise<void>;
    private agregarReglaFirewallSiNoExiste;
    crearDhcpBinding(creds: RouterCredentials, binding: DhcpStaticBinding): Promise<string>;
    eliminarDhcpBinding(creds: RouterCredentials, macAddress: string): Promise<void>;
    listarDhcpLeases(creds: RouterCredentials): Promise<any[]>;
    listarServidoresDhcp(creds: RouterCredentials): Promise<any[]>;
}
