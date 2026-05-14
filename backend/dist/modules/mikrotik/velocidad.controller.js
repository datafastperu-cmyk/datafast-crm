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
var VelocidadController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VelocidadController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_2 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const velocidad_orquestador_service_1 = require("./services/velocidad/velocidad-orquestador.service");
const velocidad_service_1 = require("./services/velocidad/velocidad.service");
const mikrotik_service_1 = require("./mikrotik.service");
const velocidad_worker_1 = require("./velocidad.worker");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
class AplicarVelocidadDto {
}
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], AplicarVelocidadDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AplicarVelocidadDto.prototype, "usuarioPppoe", void 0);
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AplicarVelocidadDto.prototype, "ipAsignada", void 0);
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AplicarVelocidadDto.prototype, "downloadMbps", void 0);
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AplicarVelocidadDto.prototype, "uploadMbps", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AplicarVelocidadDto.prototype, "burstDownMbps", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AplicarVelocidadDto.prototype, "burstUpMbps", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AplicarVelocidadDto.prototype, "burstTiempoSeg", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: 'simple_queue' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AplicarVelocidadDto.prototype, "tipoQueuePlan", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: 'residencial' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AplicarVelocidadDto.prototype, "tipoPlan", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AplicarVelocidadDto.prototype, "wanIface", void 0);
class CambiarVelocidadDto {
}
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CambiarVelocidadDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CambiarVelocidadDto.prototype, "usuarioPppoe", void 0);
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CambiarVelocidadDto.prototype, "downloadMbps", void 0);
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CambiarVelocidadDto.prototype, "uploadMbps", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(8),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CambiarVelocidadDto.prototype, "prioridad", void 0);
let VelocidadController = VelocidadController_1 = class VelocidadController {
    constructor(orquestador, velocidadSvc, mikrotikSvc, scheduler) {
        this.orquestador = orquestador;
        this.velocidadSvc = velocidadSvc;
        this.mikrotikSvc = mikrotikSvc;
        this.scheduler = scheduler;
        this.logger = new common_1.Logger(VelocidadController_1.name);
    }
    async aplicar(routerId, dto, user) {
        const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
        const creds = this.buildCreds(router);
        const resultado = await this.orquestador.aplicarVelocidad({
            routerCreds: creds,
            clienteId: dto.clienteId,
            usuarioPppoe: dto.usuarioPppoe,
            ipAsignada: dto.ipAsignada,
            downloadMbps: dto.downloadMbps,
            uploadMbps: dto.uploadMbps,
            burstDownMbps: dto.burstDownMbps,
            burstUpMbps: dto.burstUpMbps,
            burstTiempoSeg: dto.burstTiempoSeg,
            tipoQueuePlan: dto.tipoQueuePlan || 'simple_queue',
            tipoPlan: dto.tipoPlan || 'residencial',
            wanIface: dto.wanIface,
        });
        return response_dto_1.ApiResponse.ok(resultado, resultado.exitoso ? 'Velocidad aplicada' : 'Error al aplicar velocidad');
    }
    async cambiar(routerId, dto, user) {
        const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
        const creds = this.buildCreds(router);
        const resultado = await this.orquestador.cambiarVelocidadPlan(creds, dto.clienteId, dto.usuarioPppoe, dto.downloadMbps, dto.uploadMbps, dto.prioridad);
        return response_dto_1.ApiResponse.ok(resultado, resultado.actualizado ? 'Velocidad actualizada' : resultado.detalle);
    }
    async getCapacidad(routerId, user) {
        const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
        const creds = this.buildCreds(router);
        const cap = await this.velocidadSvc.detectarCapacidad(creds);
        return response_dto_1.ApiResponse.ok(cap);
    }
    async sincronizar(routerId, user) {
        const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
        const creds = this.buildCreds(router);
        const resultado = await this.orquestador.sincronizarVelocidades(creds, routerId);
        return response_dto_1.ApiResponse.ok(resultado, `Sincronización: ${resultado.actualizados} actualizados, ${resultado.errores} errores`);
    }
    async encolarSincronizacion(routerId, user) {
        const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
        await this.scheduler.enqueueVelocidadChange({
            routerId,
            empresaId: user.empresaId,
            clienteId: 'sync-masivo',
            usuarioPppoe: 'sync',
            downloadMbps: 0,
            uploadMbps: 0,
        });
        return response_dto_1.ApiResponse.ok(null, 'Sincronización encolada — se ejecutará en segundo plano');
    }
    async getDiscrepancias(routerId, user) {
        const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
        const creds = this.buildCreds(router);
        const contratos = await this.velocidadSvc['ds']?.query?.(`
      SELECT co.usuario_pppoe, pl.velocidad_bajada AS download_mbps, pl.velocidad_subida AS upload_mbps
      FROM contratos co JOIN planes pl ON pl.id = co.plan_id
      WHERE co.router_id = $1 AND co.estado IN ('activo','prorroga') AND co.deleted_at IS NULL
    `, [routerId]) || [];
        const planesPorQueue = new Map(contratos.map((c) => [c.usuario_pppoe, {
                downloadMbps: c.download_mbps,
                uploadMbps: c.upload_mbps,
            }]));
        const discrepancias = await this.velocidadSvc.listarDiscrepancias(creds, planesPorQueue);
        return response_dto_1.ApiResponse.ok(discrepancias, `${discrepancias.length} discrepancias encontradas`);
    }
    buildCreds(router) {
        return {
            id: router.id,
            ip: router.ipGestion,
            port: router.usarSsl ? router.puertoApiSsl : router.puertoApi,
            user: router.usuario,
            passwordCifrado: router.passwordCifrado,
            useSsl: router.usarSsl,
            timeoutSec: router.timeoutConexion || 10,
            version: router.versionRos === 'v7' ? 'v7' : 'v6',
        };
    }
};
exports.VelocidadController = VelocidadController;
__decorate([
    (0, common_1.Post)('aplicar'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, swagger_1.ApiOperation)({
        summary: 'Aplicar control de velocidad para un cliente',
        description: 'Detecta automáticamente la capacidad del router y aplica la estrategia ' +
            'óptima: Simple Queue, Queue Tree individual, o PCQ global.',
    }),
    (0, swagger_1.ApiParam)({ name: 'routerId' }),
    __param(0, (0, common_1.Param)('routerId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, AplicarVelocidadDto, Object]),
    __metadata("design:returntype", Promise)
], VelocidadController.prototype, "aplicar", null);
__decorate([
    (0, common_1.Patch)('cambiar'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Cambiar velocidad de un cliente sin desconectarlo',
        description: 'Modifica max-limit en Queue Tree o Simple Queue existente. ' +
            'El cliente no pierde la conexión. ' +
            'También puede usarse para cambios de plan inmediatos.',
    }),
    (0, swagger_1.ApiParam)({ name: 'routerId' }),
    __param(0, (0, common_1.Param)('routerId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, CambiarVelocidadDto, Object]),
    __metadata("design:returntype", Promise)
], VelocidadController.prototype, "cambiar", null);
__decorate([
    (0, common_1.Get)('capacidad'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Detectar capacidad de queue del router',
        description: 'Verifica qué tipos de queue están disponibles: PCQ, Queue Tree, Simple Queue.',
    }),
    (0, swagger_1.ApiParam)({ name: 'routerId' }),
    __param(0, (0, common_1.Param)('routerId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], VelocidadController.prototype, "getCapacidad", null);
__decorate([
    (0, common_1.Post)('sincronizar'),
    (0, roles_decorator_1.Roles)('Administrador', 'Supervisor'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Sincronizar velocidades de todos los clientes del router',
        description: 'Compara las queues en el router con los planes en la base de datos ' +
            'y corrige discrepancias. Puede tomar varios segundos.',
    }),
    (0, swagger_1.ApiParam)({ name: 'routerId' }),
    __param(0, (0, common_1.Param)('routerId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], VelocidadController.prototype, "sincronizar", null);
__decorate([
    (0, common_1.Post)('sincronizar/encolar'),
    (0, roles_decorator_1.Roles)('Administrador'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, swagger_1.ApiOperation)({
        summary: 'Encolar sincronización asíncrona (Bull Job)',
        description: 'Encola la sincronización para ejecutarla en segundo plano sin bloquear la API.',
    }),
    (0, swagger_1.ApiParam)({ name: 'routerId' }),
    __param(0, (0, common_1.Param)('routerId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], VelocidadController.prototype, "encolarSincronizacion", null);
__decorate([
    (0, common_1.Get)('discrepancias'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar discrepancias de velocidad sin corregirlas',
        description: 'Muestra qué clientes tienen una velocidad diferente a su plan, sin modificar nada.',
    }),
    (0, swagger_1.ApiParam)({ name: 'routerId' }),
    __param(0, (0, common_1.Param)('routerId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], VelocidadController.prototype, "getDiscrepancias", null);
exports.VelocidadController = VelocidadController = VelocidadController_1 = __decorate([
    (0, swagger_1.ApiTags)('Mikrotik - Velocidad'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('mikrotik/routers/:routerId/velocidad'),
    __metadata("design:paramtypes", [velocidad_orquestador_service_1.VelocidadOrquestador,
        velocidad_service_1.VelocidadService,
        mikrotik_service_1.MikrotikService,
        velocidad_worker_1.VelocidadScheduler])
], VelocidadController);
//# sourceMappingURL=velocidad.controller.js.map