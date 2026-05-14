"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var HealthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthService = void 0;
const common_1 = require("@nestjs/common");
const terminus_1 = require("@nestjs/terminus");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const ioredis_1 = require("ioredis");
let HealthService = HealthService_1 = class HealthService extends terminus_1.HealthIndicator {
    constructor(dataSource, config) {
        super();
        this.dataSource = dataSource;
        this.config = config;
        this.logger = new common_1.Logger(HealthService_1.name);
        this.redis = new ioredis_1.default({
            host: config.get('redis.host'),
            port: config.get('redis.port'),
            password: config.get('redis.password'),
            db: 0,
            connectTimeout: 3000,
            lazyConnect: true,
        });
    }
    async checkRedis() {
        try {
            await this.redis.connect().catch(() => { });
            const pong = await this.redis.ping();
            const info = await this.redis.info('server');
            const versionMatch = info.match(/redis_version:(.+)\r/);
            const version = versionMatch ? versionMatch[1].trim() : 'unknown';
            return this.getStatus('redis', pong === 'PONG', {
                version,
                status: 'connected',
            });
        }
        catch (error) {
            this.logger.error(`Redis health check failed: ${error.message}`);
            return this.getStatus('redis', false, {
                message: error.message,
            });
        }
    }
    async getSystemInfo() {
        const memUsage = process.memoryUsage();
        const dbConnected = this.dataSource.isInitialized;
        let dbStats = null;
        if (dbConnected) {
            try {
                const result = await this.dataSource.query(`
          SELECT 
            count(*) as active_connections
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
        `);
                dbStats = {
                    connected: true,
                    activeConnections: parseInt(result[0]?.active_connections || '0'),
                };
            }
            catch {
                dbStats = { connected: dbConnected };
            }
        }
        return {
            memory: {
                heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
                rssMb: Math.round(memUsage.rss / 1024 / 1024),
                externalMb: Math.round(memUsage.external / 1024 / 1024),
            },
            database: dbStats,
            node: {
                version: process.version,
                platform: process.platform,
                arch: process.arch,
            },
        };
    }
};
exports.HealthService = HealthService;
exports.HealthService = HealthService = HealthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource,
        config_1.ConfigService])
], HealthService);
//# sourceMappingURL=health.service.js.map