export interface SystemInfo {
    sysDescr: string;
    sysUpTime: number;
    sysName: string;
    cpuPct?: number;
    memoriaPct?: number;
    temperatura?: number;
    cpuUsage?: number;
    memoryUsage?: number;
}
export interface InterfaceStats {
    index: number;
    description: string;
    speed: number;
    operStatus: number;
    rxBytes: number;
    txBytes: number;
    rxBps?: number;
    txBps?: number;
}
export declare class SnmpService {
    private readonly logger;
    getSystemInfo(host: string, community?: string, version?: number, extended?: boolean): Promise<SystemInfo | null>;
    getCpuMemory(host: string, community?: string, version?: number): Promise<{
        cpu: number | null;
        memory: number | null;
    }>;
    getInterfaces(host: string, community?: string, version?: number): Promise<InterfaceStats[]>;
    getTraficoInterfaz(host: string, community: string, ifIndex: number, version?: number): Promise<{
        rxBps: number;
        txBps: number;
    } | null>;
    testConnection(host: string, community?: string, version?: number): Promise<boolean>;
    private _createSession;
    private _get;
}
