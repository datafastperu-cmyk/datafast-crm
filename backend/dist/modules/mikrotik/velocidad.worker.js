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
var VelocidadScheduler_1, VelocidadWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VelocidadWorker = exports.VelocidadScheduler = exports.VELOCIDAD_QUEUE = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const bull_2 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const typeorm_3 = require("@nestjs/typeorm");
const typeorm_4 = require("typeorm");
const velocidad_orquestador_service_1 = require("./services/velocidad/velocidad-orquestador.service");
const router_entity_1 = require("./entities/router.entity");
const connection_pool_service_1 = require("./services/connection-pool.service");
exports.VELOCIDAD_QUEUE = 'velocidad-sync';
let VelocidadScheduler = VelocidadScheduler_1 = class VelocidadScheduler {
    constructor(queue, routerRepo, ds) {
        this.queue = queue;
        this.routerRepo = routerRepo;
        this.ds = ds;
        this.logger = new common_1.Logger(VelocidadScheduler_1.name);
    }
    async scheduleSync() {
        this.logger.log('Iniciando sincronización periódica de velocidades');
        const routers = await this.routerRepo.find({
            where: { activo: true, estado: router_entity_1.EstadoEquipo.ONLINE, deletedAt: null },
        });
        for (const router of routers) {
            await this.queue.add('sincronizar-router', { routerId: router.id, empresaId: router.empresaId }, {
                delay: routers.indexOf(router) * 30_000,
                attempts: 2,
                backoff: { type: 'fixed', delay: 60_000 },
                removeOnComplete: true,
            });
        }
        this.logger.log(`${routers.length} routers encolados para sincronización`);
    }
    async enqueueVelocidadChange(payload) {
        await this.queue.add('cambiar-velocidad', payload, {
            priority: 1,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: true,
        });
        this.logger.log(`Cambio de velocidad encolado: cliente ${payload.clienteId} | ` +
            `${payload.downloadMbps}/${payload.uploadMbps} Mbps`);
    }
};
exports.VelocidadScheduler = VelocidadScheduler;
__decorate([
    (0, schedule_1.Cron)('0 */4 * * *', { timeZone: 'America/Lima' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], VelocidadScheduler.prototype, "scheduleSync", null);
exports.VelocidadScheduler = VelocidadScheduler = VelocidadScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_2.InjectQueue)(exports.VELOCIDAD_QUEUE)),
    __param(1, (0, typeorm_1.InjectRepository)(router_entity_1.Router)),
    __param(2, (0, typeorm_3.InjectDataSource)()),
    __metadata("design:paramtypes", [Object, typeorm_2.Repository,
        typeorm_4.DataSource])
], VelocidadScheduler);
let VelocidadWorker = VelocidadWorker_1 = class VelocidadWorker {
    constructor(orquestador, pool, routerRepo) {
        this.orquestador = orquestador;
        this.pool = pool;
        this.routerRepo = routerRepo;
        this.logger = new common_1.Logger(VelocidadWorker_1.name);
    }
    async processSincronizarRouter(job) {
        const { routerId, empresaId } = job.data;
        this.logger.log(`Sincronizando velocidades: router ${routerId}`);
        const router = await this.routerRepo.findOne({
            where: { id: routerId, activo: true, deletedAt: null },
        });
        if (!router) {
            this.logger.warn(`Router ${routerId} no encontrado o inactivo`);
            return { omitido: true };
        }
        const creds = {
            id: router.id,
            ip: router.ipGestion,
            port: router.usarSsl ? router.puertoApiSsl : router.puertoApi,
            user: router.usuario,
            passwordCifrado: router.passwordCifrado,
            useSsl: router.usarSsl,
            timeoutSec: router.timeoutConexion || 10,
            version: router.versionRos === router_entity_1.VersionRouterOS.V7 ? 'v7' : 'v6',
        };
        const resultado = await this.orquestador.sincronizarVelocidades(creds, routerId);
        await job.progress(100);
        this.logger.log(`Sincronización ${routerId}: ` +
            `${resultado.actualizados} actualizados, ${resultado.errores} errores`);
        return resultado;
    }
    async processCambiarVelocidad(job) {
        const { routerId, clienteId, usuarioPppoe, downloadMbps, uploadMbps, prioridad } = job.data;
        this.logger.log(`Aplicando cambio de velocidad: cliente ${clienteId} → ` +
            `${downloadMbps}/${uploadMbps} Mbps en router ${routerId}`);
        const router = await this.routerRepo.findOne({
            where: { id: routerId, activo: true, deletedAt: null },
        });
        if (!router) {
            this.logger.warn(`Router ${routerId} no disponible para cambio de velocidad`);
            return { omitido: true };
        }
        const creds = {
            id: router.id,
            ip: router.ipGestion,
            port: router.usarSsl ? router.puertoApiSsl : router.puertoApi,
            user: router.usuario,
            passwordCifrado: router.passwordCifrado,
            useSsl: router.usarSsl,
            timeoutSec: router.timeoutConexion || 10,
            version: router.versionRos === router_entity_1.VersionRouterOS.V7 ? 'v7' : 'v6',
        };
        const resultado = await this.orquestador.cambiarVelocidadPlan(creds, clienteId, usuarioPppoe, downloadMbps, uploadMbps, prioridad);
        await job.progress(100);
        this.logger.log(`Cambio de velocidad ${clienteId}: ` +
            `${resultado.actualizado ? 'exitoso' : 'fallido'} | ${resultado.detalle}`);
        return resultado;
    }
    onFailed(job, error) {
        this.logger.error(`Job ${job.name} #${job.id} falló (intento ${job.attemptsMade}): ${error.message}`);
    }
    onCompleted(job) {
        this.logger.debug(`Job ${job.name} #${job.id} completado`);
    }
};
exports.VelocidadWorker = VelocidadWorker;
__decorate([
    (0, bull_1.Process)('sincronizar-router'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VelocidadWorker.prototype, "processSincronizarRouter", null);
__decorate([
    (0, bull_1.Process)('cambiar-velocidad'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VelocidadWorker.prototype, "processCambiarVelocidad", null);
__decorate([
    (0, bull_1.OnQueueFailed)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Error]),
    __metadata("design:returntype", void 0)
], VelocidadWorker.prototype, "onFailed", null);
__decorate([
    (0, bull_1.OnQueueCompleted)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], VelocidadWorker.prototype, "onCompleted", null);
exports.VelocidadWorker = VelocidadWorker = VelocidadWorker_1 = __decorate([
    (0, bull_1.Processor)(exports.VELOCIDAD_QUEUE),
    __param(2, (0, typeorm_1.InjectRepository)(router_entity_1.Router)),
    __metadata("design:paramtypes", [velocidad_orquestador_service_1.VelocidadOrquestador,
        connection_pool_service_1.RouterConnectionPool,
        typeorm_2.Repository])
], VelocidadWorker);
//# sourceMappingURL=velocidad.worker.js.map