export declare const redisConfig: (() => {
    host: string;
    port: number;
    password: string;
    db: {
        cache: number;
        typeorm: number;
        queues: number;
        rateLimit: number;
        websocket: number;
    };
    connectTimeout: number;
    maxRetriesPerRequest: number;
    enableReadyCheck: boolean;
    lazyConnect: boolean;
    defaultTtl: number;
    keyPrefix: {
        session: string;
        cache: string;
        rateLimit: string;
        blacklist: string;
        otp: string;
    };
}) & import("@nestjs/config").ConfigFactoryKeyHost<{
    host: string;
    port: number;
    password: string;
    db: {
        cache: number;
        typeorm: number;
        queues: number;
        rateLimit: number;
        websocket: number;
    };
    connectTimeout: number;
    maxRetriesPerRequest: number;
    enableReadyCheck: boolean;
    lazyConnect: boolean;
    defaultTtl: number;
    keyPrefix: {
        session: string;
        cache: string;
        rateLimit: string;
        blacklist: string;
        otp: string;
    };
}>;
export declare const bullRedisOptions: {
    redis: {
        host: string;
        port: number;
        password: string;
        db: number;
        maxRetriesPerRequest: any;
        enableReadyCheck: boolean;
    };
};
