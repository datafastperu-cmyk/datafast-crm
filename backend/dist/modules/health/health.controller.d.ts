import { HealthCheckService, TypeOrmHealthIndicator, MemoryHealthIndicator, DiskHealthIndicator } from '@nestjs/terminus';
import { HealthService } from './health.service';
export declare class HealthController {
    private readonly health;
    private readonly db;
    private readonly memory;
    private readonly disk;
    private readonly healthService;
    constructor(health: HealthCheckService, db: TypeOrmHealthIndicator, memory: MemoryHealthIndicator, disk: DiskHealthIndicator, healthService: HealthService);
    check(): Promise<import("@nestjs/terminus").HealthCheckResult>;
    liveness(): {
        status: string;
        timestamp: string;
        uptime: number;
        pid: number;
    };
    readiness(): Promise<import("@nestjs/terminus").HealthCheckResult>;
    status(): Promise<{
        memory: {
            heapUsedMb: number;
            heapTotalMb: number;
            rssMb: number;
            externalMb: number;
        };
        database: any;
        node: {
            version: string;
            platform: NodeJS.Platform;
            arch: NodeJS.Architecture;
        };
        success: boolean;
        app: string;
        version: string;
        environment: string;
        timezone: string;
        timestamp: string;
        uptime: number;
    }>;
}
