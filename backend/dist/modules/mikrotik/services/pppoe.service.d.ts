import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';
export interface PppoeUser {
    id?: string;
    name: string;
    password: string;
    profile: string;
    service: string;
    remoteAddress?: string;
    comment?: string;
    disabled: boolean;
    callerID?: string;
    lastLoggedOut?: string;
}
export interface PppoeSecret {
    '.id': string;
    name: string;
    password: string;
    profile: string;
    service: string;
    'remote-address'?: string;
    comment?: string;
    disabled: string;
    'last-logged-out'?: string;
    'caller-id'?: string;
}
export interface PppoeSession {
    '.id': string;
    name: string;
    service: string;
    'caller-id': string;
    address: string;
    uptime: string;
    encoding: string;
    'session-id': string;
    comment?: string;
    'rx-bytes': string;
    'tx-bytes': string;
    mtu: string;
}
export interface CreatePppoeParams {
    name: string;
    password: string;
    profile: string;
    service?: string;
    remoteAddress?: string;
    comment?: string;
    disabled?: boolean;
}
export declare class PppoeService {
    private readonly pool;
    private readonly logger;
    constructor(pool: RouterConnectionPool);
    crear(creds: RouterCredentials, params: CreatePppoeParams): Promise<string>;
    eliminar(creds: RouterCredentials, name: string): Promise<void>;
    setEstado(creds: RouterCredentials, name: string, disabled: boolean): Promise<void>;
    desconectarSesion(creds: RouterCredentials, name: string): Promise<void>;
    cambiarPassword(creds: RouterCredentials, name: string, newPassword: string): Promise<void>;
    listarSecrets(creds: RouterCredentials, filter?: string): Promise<any[]>;
    listarSesionesActivas(creds: RouterCredentials): Promise<any[]>;
    getSesion(creds: RouterCredentials, name: string): Promise<any | null>;
    listarPerfiles(creds: RouterCredentials): Promise<any[]>;
    crearPerfilSiNoExiste(creds: RouterCredentials, nombre: string, params: {
        rateLimit?: string;
        sessionTimeout?: string;
    }): Promise<void>;
    getTraficoSesion(creds: RouterCredentials, name: string): Promise<{
        rxBytes: number;
        txBytes: number;
        uptime: string;
    } | null>;
}
