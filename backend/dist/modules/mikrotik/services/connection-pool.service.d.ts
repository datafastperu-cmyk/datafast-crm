import { OnModuleDestroy } from '@nestjs/common';
import { RouterOSAPI } from 'node-routeros';
export interface RouterCredentials {
    id: string;
    ip: string;
    port: number;
    user: string;
    passwordCifrado: string;
    useSsl: boolean;
    timeoutSec: number;
    version: string;
}
export declare class RouterConnectionPool implements OnModuleDestroy {
    private readonly logger;
    private readonly pool;
    private readonly MAX_PER_ROUTER;
    private readonly IDLE_TIMEOUT_MS;
    private readonly CONNECT_TIMEOUT;
    private cleanupInterval;
    constructor();
    acquire(creds: RouterCredentials): Promise<RouterOSAPI>;
    release(routerId: string, api: RouterOSAPI): void;
    invalidate(routerId: string): Promise<void>;
    connectDirect(creds: RouterCredentials): Promise<RouterOSAPI>;
    private cleanup;
    private connect;
    execute<T = any>(creds: RouterCredentials, fn: (api: RouterOSAPI) => Promise<T>, retries?: number): Promise<T>;
    private isConnectionError;
    onModuleDestroy(): Promise<void>;
}
