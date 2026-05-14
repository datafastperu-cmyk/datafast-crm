export interface PingResult {
    ip: string;
    alive: boolean;
    latencyMs: number | null;
    lossPerct: number;
    min: number | null;
    max: number | null;
    avg: number | null;
    stddev: number | null;
}
export declare class PingService {
    private readonly logger;
    private readonly isLinux;
    private readonly isDarwin;
    ping(ip: string, count?: number, timeoutMs?: number, retries?: number): Promise<PingResult>;
    pingBulk(ips: string[], count?: number, timeoutMs?: number, concurrency?: number): Promise<Map<string, PingResult>>;
    private icmpPing;
    private parsePingOutput;
    private tcpPing;
    private tcpConnect;
    private sleep;
}
