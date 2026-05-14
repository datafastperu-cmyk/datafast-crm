import { HealthIndicatorResult, HealthIndicator } from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
export declare class HealthService extends HealthIndicator {
    private readonly dataSource;
    private readonly config;
    private readonly logger;
    private redis;
    constructor(dataSource: DataSource, config: ConfigService);
    checkRedis(): Promise<HealthIndicatorResult>;
    getSystemInfo(): Promise<{
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
    }>;
}
