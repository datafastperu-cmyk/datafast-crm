import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';
export interface InterfaceInfo {
    name: string;
    type: string;
    macAddress: string;
    mtu: number;
    running: boolean;
    disabled: boolean;
    rxBytes: number;
    txBytes: number;
    rxRate: number;
    txRate: number;
    rxErrors: number;
    txErrors: number;
    lastLinkUp?: string;
    comment?: string;
}
export interface RouterResources {
    version: string;
    buildTime: string;
    freeMemory: number;
    totalMemory: number;
    cpuLoad: number;
    cpuFreq: number;
    freeHdd: number;
    totalHdd: number;
    uptime: string;
    uptimeSeconds: number;
    boardName: string;
    platform: string;
    temperature?: number;
}
export interface IpAddress {
    address: string;
    network: string;
    interface: string;
    comment?: string;
    disabled: boolean;
}
export interface ArpEntry {
    address: string;
    macAddress: string;
    interface: string;
    dynamic: boolean;
    complete: boolean;
}
export declare class InterfaceService {
    private readonly pool;
    private readonly logger;
    constructor(pool: RouterConnectionPool);
    getRecursos(creds: RouterCredentials): Promise<RouterResources>;
    getIdentity(creds: RouterCredentials): Promise<string>;
    listarInterfaces(creds: RouterCredentials): Promise<InterfaceInfo[]>;
    monitorearInterface(creds: RouterCredentials, ifaceName: string, samples?: number): Promise<{
        rxBps: number;
        txBps: number;
        rxPps: number;
        txPps: number;
    }[]>;
    listarIps(creds: RouterCredentials): Promise<IpAddress[]>;
    getArp(creds: RouterCredentials, ip?: string): Promise<ArpEntry[]>;
    listarRutas(creds: RouterCredentials): Promise<any[]>;
    getLog(creds: RouterCredentials, limit?: number): Promise<any[]>;
    detectarVersion(creds: RouterCredentials): Promise<'v6' | 'v7'>;
    ping(creds: RouterCredentials, destino: string, count?: number): Promise<{
        avg: number;
        min: number;
        max: number;
        loss: number;
    }>;
    parseUptime(uptime: string): number;
}
