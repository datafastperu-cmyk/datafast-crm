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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContratosController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const contratos_service_1 = require("./contratos.service");
const contrato_dto_1 = require("./dto/contrato.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let ContratosController = class ContratosController {
    constructor(svc) {
        this.svc = svc;
    }
    async create(dto, user, req) {
        return response_dto_1.ApiResponse.ok(await this.svc.create(dto, user, req), 'Contrato creado correctamente');
    }
    async findAll(filters, user) {
        const r = await this.svc.findAll(user.empresaId, filters);
        return response_dto_1.ApiResponse.ok(r.data, 'Contratos obtenidos', { meta: r.meta });
    }
    async getResumen(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getResumen(user.empresaId));
    }
    async findOne(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findOneCompleto(id, user.empresaId));
    }
    async findByCliente(clienteId, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findByCliente(clienteId, user.empresaId));
    }
    async update(id, dto, user, req) {
        return response_dto_1.ApiResponse.ok(await this.svc.update(id, dto, user, req), 'Contrato actualizado');
    }
    async activar(id, user, req) {
        return response_dto_1.ApiResponse.ok(await this.svc.activar(id, user, req), 'Contrato activado — servicio habilitado');
    }
    async cambiarEstado(id, dto, user, req) {
        return response_dto_1.ApiResponse.ok(await this.svc.cambiarEstado(id, dto, user, false, req), `Estado → ${dto.estado}`);
    }
    async otorgarProrroga(id, dto, user, req) {
        return response_dto_1.ApiResponse.ok(await this.svc.otorgarProrroga(id, dto, user, req), `Prórroga otorgada hasta ${dto.prorrogaHasta}`);
    }
    async getHistorial(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getHistorial(id, user.empresaId));
    }
    async remove(id, user) {
        await this.svc.remove(id, user);
    }
};
exports.ContratosController = ContratosController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.RequirePermission)('contratos:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Crear contrato — asigna IP automáticamente del pool si se provee segmentoId' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Contrato creado' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Conflicto: IP ocupada o contrato duplicado' }),
    (0, swagger_1.ApiResponse)({ status: 422, description: 'Pool IPv4 exhausto' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [contrato_dto_1.CreateContratoDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.RequirePermission)('contratos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar contratos con filtros y paginación' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [contrato_dto_1.FilterContratoDto, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('resumen'),
    (0, roles_decorator_1.RequirePermission)('contratos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Resumen de contratos por estado (dashboard)' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "getResumen", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.RequirePermission)('contratos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener contrato con datos completos (JOINs: cliente, plan, router, ONU)' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del contrato' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('cliente/:clienteId'),
    (0, roles_decorator_1.RequirePermission)('contratos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar todos los contratos de un cliente' }),
    (0, swagger_1.ApiParam)({ name: 'clienteId', description: 'UUID del cliente' }),
    __param(0, (0, common_1.Param)('clienteId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "findByCliente", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, roles_decorator_1.RequirePermission)('contratos:edit'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar datos del contrato (no cambia IP ni PPPoE)' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, contrato_dto_1.UpdateContratoDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/activar'),
    (0, roles_decorator_1.RequirePermission)('contratos:edit'),
    (0, swagger_1.ApiOperation)({ summary: 'Activar contrato (PENDIENTE_INSTALACION → ACTIVO) al finalizar la instalación' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "activar", null);
__decorate([
    (0, common_1.Patch)(':id/estado'),
    (0, roles_decorator_1.RequirePermission)('contratos:edit'),
    (0, swagger_1.ApiOperation)({ summary: 'Cambiar estado del contrato — respeta máquina de estados' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Transición no permitida' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, contrato_dto_1.CambiarEstadoContratoDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "cambiarEstado", null);
__decorate([
    (0, common_1.Patch)(':id/prorroga'),
    (0, roles_decorator_1.RequirePermission)('contratos:prorroga'),
    (0, swagger_1.ApiOperation)({ summary: 'Otorgar prórroga al contrato' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, contrato_dto_1.OtorgarProrrogaDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "otorgarProrroga", null);
__decorate([
    (0, common_1.Get)(':id/historial'),
    (0, roles_decorator_1.RequirePermission)('contratos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Historial de cambios de estado del contrato' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "getHistorial", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.RequirePermission)('contratos:delete'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Eliminar contrato (solo si está en BAJA_DEFINITIVA)' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ContratosController.prototype, "remove", null);
exports.ContratosController = ContratosController = __decorate([
    (0, swagger_1.ApiTags)('Contratos'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('contratos'),
    __metadata("design:paramtypes", [contratos_service_1.ContratosService])
], ContratosController);
//# sourceMappingURL=contratos.controller.js.map