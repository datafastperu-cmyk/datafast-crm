"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bullRedisOptions = exports.redisConfig = void 0;
const config_1 = require("@nestjs/config");
exports.redisConfig = (0, config_1.registerAs)('redis', () => ({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: {
        cache: 0,
        typeorm: 1,
        queues: 2,
        rateLimit: 3,
        websocket: 4,
    },
    connectTimeout: 10000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    defaultTtl: 300,
    keyPrefix: {
        session: 'sess:',
        cache: 'cache:',
        rateLimit: 'rl:',
        blacklist: 'jwt_bl:',
        otp: 'otp:',
    },
}));
exports.bullRedisOptions = {
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        password: process.env.REDIS_PASSWORD,
        db: 2,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    },
};
//# sourceMappingURL=redis.config.js.map