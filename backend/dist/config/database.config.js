"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseConfig = void 0;
const config_1 = require("@nestjs/config");
exports.databaseConfig = (0, config_1.registerAs)('database', () => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'fibranet',
    username: process.env.DB_USER || 'fibranet',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    migrationsTableName: 'typeorm_migrations',
    migrationsRun: process.env.NODE_ENV === 'production',
    synchronize: false,
    logging: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn', 'schema']
        : ['error', 'warn'],
    extra: {
        max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
        min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
    },
    retryAttempts: 10,
    retryDelay: 3000,
    cache: {
        type: 'ioredis',
        options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT, 10) || 6379,
            password: process.env.REDIS_PASSWORD,
            db: 1,
        },
        duration: 30000,
    },
}));
//# sourceMappingURL=database.config.js.map