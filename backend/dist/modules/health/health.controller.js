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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const terminus_1 = require("@nestjs/terminus");
const swagger_1 = require("@nestjs/swagger");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const health_service_1 = require("./health.service");
let HealthController = class HealthController {
    constructor(health, db, memory, disk, healthService) {
        this.health = health;
        this.db = db;
        this.memory = memory;
        this.disk = disk;
        this.healthService = healthService;
    }
    check() {
        return this.health.check([
            () => this.db.pingCheck('postgresql', { timeout: 3000 }),
            () => this.healthService.checkRedis(),
            () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
            () => this.memory.checkRSS('memory_rss', 750 * 1024 * 1024),
            () => this.disk.checkStorage('disk', {
                thresholdPercent: 0.9,
                path: '/',
            }),
        ]);
    }
    liveness() {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            pid: process.pid,
        };
    }
    readiness() {
        return this.health.check([
            () => this.db.pingCheck('postgresql', { timeout: 3000 }),
            () => this.healthService.checkRedis(),
        ]);
    }
    async status() {
        const info = await this.healthService.getSystemInfo();
        return {
            success: true,
            app: 'FibraNet ISP ERP',
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            timezone: process.env.TZ || 'America/Lima',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            ...info,
        };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)('health'),
    (0, public_decorator_1.Public)(),
    (0, terminus_1.HealthCheck)(),
    (0, swagger_1.ApiOperation)({ summary: 'Health check completo del sistema' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "check", null);
__decorate([
    (0, common_1.Get)('health/live'),
    (0, public_decorator_1.Public)(),
    (0, swagger_1.ApiOperation)({ summary: 'Liveness probe (Kubernetes)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "liveness", null);
__decorate([
    (0, common_1.Get)('health/ready'),
    (0, public_decorator_1.Public)(),
    (0, terminus_1.HealthCheck)(),
    (0, swagger_1.ApiOperation)({ summary: 'Readiness probe (Kubernetes)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "readiness", null);
__decorate([
    (0, common_1.Get)('status'),
    (0, public_decorator_1.Public)(),
    (0, swagger_1.ApiOperation)({ summary: 'Estado general del sistema (sin auth)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "status", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('Sistema'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [terminus_1.HealthCheckService,
        terminus_1.TypeOrmHealthIndicator,
        terminus_1.MemoryHealthIndicator,
        terminus_1.DiskHealthIndicator,
        health_service_1.HealthService])
], HealthController);
//# sourceMappingURL=health.controller.js.map