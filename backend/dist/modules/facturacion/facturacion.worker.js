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
var FacturacionScheduler_1, FacturacionWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacturacionWorker = exports.FacturacionScheduler = exports.FACTURACION_QUEUE = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const bull_2 = require("@nestjs/bull");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const facturacion_service_1 = require("./facturacion.service");
const factura_entity_1 = require("./entities/factura.entity");
exports.FACTURACION_QUEUE = 'facturacion';
let FacturacionScheduler = FacturacionScheduler_1 = class FacturacionScheduler {
    constructor(queue, ds) {
        this.queue = queue;
        this.ds = ds;
        this.logger = new common_1.Logger(FacturacionScheduler_1.name);
    }
    async scheduleDailyJobs() {
        const hoy = new Date();
        this.logger.log(`Cron diario iniciado: ${hoy.toISOString()}`);
        await this.queue.add('marcar-vencidas', {}, {
            attempts: 2,
            backoff: { type: 'fixed', delay: 30_000 },
            removeOnComplete: true,
        });
        const empresas = await this.ds.query(`
      SELECT id, dia_facturacion FROM empresas
      WHERE estado = 'activo' AND deleted_at IS NULL
    `);
        const diaHoy = hoy.getDate();
        for (const emp of empresas) {
            if (parseInt(emp.dia_facturacion, 10) === diaHoy) {
                await this.queue.add('generar-mensual', {
                    empresaId: emp.id,
                    usuarioId: 'sistema',
                    mes: hoy.getMonth() + 1,
                    anio: hoy.getFullYear(),
                }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 60_000 },
                    removeOnComplete: 100,
                    removeOnFail: 500,
                    delay: empresas.indexOf(emp) * 1000,
                });
                this.logger.log(`Facturación mensual encolada: empresa ${emp.id}`);
            }
        }
    }
};
exports.FacturacionScheduler = FacturacionScheduler;
__decorate([
    (0, schedule_1.Cron)('5 0 * * *', { timeZone: 'America/Lima' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FacturacionScheduler.prototype, "scheduleDailyJobs", null);
exports.FacturacionScheduler = FacturacionScheduler = FacturacionScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_2.InjectQueue)(exports.FACTURACION_QUEUE)),
    __param(1, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [Object, typeorm_2.DataSource])
], FacturacionScheduler);
let FacturacionWorker = FacturacionWorker_1 = class FacturacionWorker {
    constructor(facturacionSvc, ds) {
        this.facturacionSvc = facturacionSvc;
        this.ds = ds;
        this.logger = new common_1.Logger(FacturacionWorker_1.name);
    }
    async processMarcarVencidas(job) {
        this.logger.log('Procesando job: marcar-vencidas');
        const count = await this.facturacionSvc.marcarVencidas();
        this.logger.log(`Facturas vencidas marcadas: ${count}`);
        return { marcadas: count };
    }
    async processGenerarMensual(job) {
        const { empresaId, usuarioId, mes, anio } = job.data;
        this.logger.log(`Procesando generación mensual: empresa ${empresaId} | ${mes}/${anio}`);
        const userSistema = {
            sub: usuarioId,
            email: 'sistema@fibranet.pe',
            empresaId,
            nombreCompleto: 'Sistema',
            roles: ['Administrador'],
            permisos: [],
            tema: 'dark',
        };
        const resultado = await this.facturacionSvc.generarMensual({ mes, anio, tipoComprobante: factura_entity_1.TipoComprobante.BOLETA }, userSistema);
        this.logger.log(`Generación ${mes}/${anio} | empresa ${empresaId}: ` +
            `${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`);
        if (resultado.errores > 0) {
            const errDetails = resultado.detalles
                .filter(d => d.error)
                .map(d => `${d.numeroContrato}: ${d.error}`)
                .join('\n');
            this.logger.error(`Errores en generación:\n${errDetails}`);
        }
        return resultado;
    }
    onFailed(job, error) {
        this.logger.error(`Job ${job.name} #${job.id} falló (intento ${job.attemptsMade}): ${error.message}`, error.stack);
    }
    onCompleted(job, result) {
        this.logger.debug(`Job ${job.name} #${job.id} completado`);
    }
};
exports.FacturacionWorker = FacturacionWorker;
__decorate([
    (0, bull_1.Process)('marcar-vencidas'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FacturacionWorker.prototype, "processMarcarVencidas", null);
__decorate([
    (0, bull_1.Process)('generar-mensual'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FacturacionWorker.prototype, "processGenerarMensual", null);
__decorate([
    (0, bull_1.OnQueueFailed)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Error]),
    __metadata("design:returntype", void 0)
], FacturacionWorker.prototype, "onFailed", null);
__decorate([
    (0, bull_1.OnQueueCompleted)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], FacturacionWorker.prototype, "onCompleted", null);
exports.FacturacionWorker = FacturacionWorker = FacturacionWorker_1 = __decorate([
    (0, bull_1.Processor)(exports.FACTURACION_QUEUE),
    __param(1, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [facturacion_service_1.FacturacionService,
        typeorm_2.DataSource])
], FacturacionWorker);
//# sourceMappingURL=facturacion.worker.js.map