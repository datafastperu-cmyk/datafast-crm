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
var WorkersController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const bull_1 = require("@nestjs/bull");
const class_validator_1 = require("class-validator");
const swagger_2 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const cobranza_worker_1 = require("./cobranza.worker");
const facturacion_worker_1 = require("./facturacion.worker");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
const workers_constants_1 = require("./workers.constants");
class TriggerFacturacionDto {
}
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ example: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(12),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], TriggerFacturacionDto.prototype, "mes", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ example: 2024 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], TriggerFacturacionDto.prototype, "anio", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], TriggerFacturacionDto.prototype, "forzar", void 0);
class TriggerCobranzaDto {
}
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ example: 5 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], TriggerCobranzaDto.prototype, "diasGracia", void 0);
let WorkersController = WorkersController_1 = class WorkersController {
    constructor(cobranzaQueue, facturacionQueue, cobranzaSched, facturacionSched) {
        this.cobranzaQueue = cobranzaQueue;
        this.facturacionQueue = facturacionQueue;
        this.cobranzaSched = cobranzaSched;
        this.facturacionSched = facturacionSched;
        this.logger = new common_1.Logger(WorkersController_1.name);
    }
    async getStatus() {
        const [cobranza, facturacion] = await Promise.all([
            this.cobranzaQueue.getJobCounts(),
            this.facturacionQueue.getJobCounts(),
        ]);
        return response_dto_1.ApiResponse.ok({
            cobranza: { ...cobranza, nombre: workers_constants_1.QUEUES.COBRANZA },
            facturacion: { ...facturacion, nombre: workers_constants_1.QUEUES.FACTURACION },
            timestamp: new Date().toISOString(),
        });
    }
    async getJobs(cola, estado) {
        const queue = cola === 'facturacion' ? this.facturacionQueue : this.cobranzaQueue;
        const limit = 20;
        let jobs = [];
        switch (estado) {
            case 'active':
                jobs = await queue.getActive(0, limit);
                break;
            case 'waiting':
                jobs = await queue.getWaiting(0, limit);
                break;
            case 'failed':
                jobs = await queue.getFailed(0, limit);
                break;
            case 'completed':
                jobs = await queue.getCompleted(0, limit);
                break;
            default:
                jobs = [
                    ...(await queue.getActive(0, 5)),
                    ...(await queue.getWaiting(0, 5)),
                    ...(await queue.getFailed(0, 5)),
                ];
        }
        return response_dto_1.ApiResponse.ok(jobs.map((j) => ({
            id: j.id,
            name: j.name,
            state: j.data ? 'pending' : 'unknown',
            data: j.data,
            progress: j.progress(),
            attemptsMade: j.attemptsMade,
            timestamp: j.timestamp,
            processedOn: j.processedOn,
            finishedOn: j.finishedOn,
            failedReason: j.failedReason,
        })));
    }
    async triggerFacturacion(dto, user) {
        const hoy = new Date();
        const mes = dto.mes || hoy.getMonth() + 1;
        const anio = dto.anio || hoy.getFullYear();
        const jobId = await this.facturacionSched.enqueueGeneracionManual(user.empresaId, mes, anio, dto.forzar || false);
        this.logger.log(`[TRIGGER] Facturación ${mes}/${anio} encolada por ${user.email} | Job: ${jobId}`);
        return response_dto_1.ApiResponse.ok({ jobId, mes, anio, empresaId: user.empresaId }, `Generación de facturas ${mes}/${anio} encolada (job #${jobId})`);
    }
    async triggerCobranza(user) {
        await this.cobranzaSched.detectarMorosos();
        this.logger.log(`[TRIGGER] Detección de morosos lanzada por ${user.email}`);
        return response_dto_1.ApiResponse.ok(null, 'Detección de morosos iniciada — revisa la cola de cobranza');
    }
    async cleanQueues(user) {
        await Promise.all([
            this.cobranzaQueue.clean(0, 'completed'),
            this.cobranzaQueue.clean(0, 'failed'),
            this.facturacionQueue.clean(0, 'completed'),
            this.facturacionQueue.clean(0, 'failed'),
        ]);
        this.logger.log(`[CLEAN] Colas limpiadas por ${user.email}`);
        return response_dto_1.ApiResponse.ok(null, 'Colas limpiadas correctamente');
    }
    async retryFailed(cola, user) {
        const queue = cola === 'facturacion' ? this.facturacionQueue : this.cobranzaQueue;
        const failed = await queue.getFailed(0, 100);
        let reintentados = 0;
        for (const job of failed) {
            await job.retry();
            reintentados++;
        }
        this.logger.log(`[RETRY] ${reintentados} jobs fallidos reencolados en ${cola || 'cobranza'} por ${user.email}`);
        return response_dto_1.ApiResponse.ok({ reintentados }, `${reintentados} jobs reencolados`);
    }
};
exports.WorkersController = WorkersController;
__decorate([
    (0, common_1.Get)('status'),
    (0, swagger_1.ApiOperation)({
        summary: 'Estado de todas las colas Bull',
        description: 'Jobs en espera, activos, completados y fallidos por cola.',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], WorkersController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Get)('jobs'),
    (0, swagger_1.ApiOperation)({ summary: 'Jobs recientes por cola y estado' }),
    (0, swagger_1.ApiQuery)({ name: 'cola', required: false, enum: ['cobranza', 'facturacion'] }),
    (0, swagger_1.ApiQuery)({ name: 'estado', required: false, enum: ['active', 'waiting', 'failed', 'completed'] }),
    __param(0, (0, common_1.Query)('cola')),
    __param(1, (0, common_1.Query)('estado')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], WorkersController.prototype, "getJobs", null);
__decorate([
    (0, common_1.Post)('facturacion/trigger'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, swagger_1.ApiOperation)({
        summary: 'Disparar generación masiva de facturas manualmente',
        description: 'Encola la generación de facturas para la empresa actual (o todas si es superadmin). ' +
            'Útil para regenerar facturas de un mes específico.',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [TriggerFacturacionDto, Object]),
    __metadata("design:returntype", Promise)
], WorkersController.prototype, "triggerFacturacion", null);
__decorate([
    (0, common_1.Post)('cobranza/trigger'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, swagger_1.ApiOperation)({
        summary: 'Disparar detección de morosos manualmente',
        description: 'Ejecuta el proceso de detección de contratos morosos inmediatamente. ' +
            'Normalmente se ejecuta automáticamente a las 06:00 AM.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WorkersController.prototype, "triggerCobranza", null);
__decorate([
    (0, common_1.Post)('clean'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Limpiar jobs completados y fallidos de las colas',
        description: 'Elimina los jobs completados y fallidos de todas las colas Bull.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WorkersController.prototype, "cleanQueues", null);
__decorate([
    (0, common_1.Post)('retry-failed'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, swagger_1.ApiOperation)({
        summary: 'Re-encolar todos los jobs fallidos',
        description: 'Mueve los jobs fallidos de vuelta a la cola de espera.',
    }),
    __param(0, (0, common_1.Query)('cola')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], WorkersController.prototype, "retryFailed", null);
exports.WorkersController = WorkersController = WorkersController_1 = __decorate([
    (0, swagger_1.ApiTags)('Workers — Admin'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, roles_decorator_1.Roles)('Administrador'),
    (0, common_1.Controller)('admin/workers'),
    __param(0, (0, bull_1.InjectQueue)(workers_constants_1.QUEUES.COBRANZA)),
    __param(1, (0, bull_1.InjectQueue)(workers_constants_1.QUEUES.FACTURACION)),
    __metadata("design:paramtypes", [Object, Object, cobranza_worker_1.CobranzaScheduler,
        facturacion_worker_1.FacturacionScheduler])
], WorkersController);
//# sourceMappingURL=workers.controller.js.map