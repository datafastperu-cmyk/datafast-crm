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
var ClientesController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const common_2 = require("@nestjs/common");
const clientes_service_1 = require("./clientes.service");
const cliente_dto_1 = require("./dto/cliente.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let ClientesController = ClientesController_1 = class ClientesController {
    constructor(clientesSvc) {
        this.clientesSvc = clientesSvc;
        this.logger = new common_1.Logger(ClientesController_1.name);
    }
    async create(dto, user, req) {
        const cliente = await this.clientesSvc.create(dto, user, req);
        return response_dto_1.ApiResponse.ok(cliente, 'Cliente registrado correctamente');
    }
    async findAll(filters, user) {
        const result = await this.clientesSvc.findAll(user.empresaId, filters);
        return response_dto_1.ApiResponse.ok(result.data, 'Clientes obtenidos', { meta: result.meta });
    }
    async getResumen(user) {
        const data = await this.clientesSvc.getResumen(user.empresaId);
        return response_dto_1.ApiResponse.ok(data);
    }
    async getMapa(user) {
        const data = await this.clientesSvc.getMapa(user.empresaId);
        return response_dto_1.ApiResponse.ok(data);
    }
    async exportar(filters, user, res) {
        this.logger.log(`Exportando clientes | empresa: ${user.empresaId} | formato: ${filters.formato}`);
        await this.clientesSvc.exportar(user.empresaId, filters, res);
    }
    async consultarReniec(dto) {
        const data = await this.clientesSvc.consultarReniec(dto.dni);
        return response_dto_1.ApiResponse.ok(data, 'Datos RENIEC obtenidos correctamente');
    }
    async findOne(id, user) {
        const data = await this.clientesSvc.findOne(id, user.empresaId);
        return response_dto_1.ApiResponse.ok(data);
    }
    async update(id, dto, user, req) {
        const data = await this.clientesSvc.update(id, dto, user, req);
        return response_dto_1.ApiResponse.ok(data, 'Cliente actualizado correctamente');
    }
    async patch(id, dto, user, req) {
        const data = await this.clientesSvc.update(id, dto, user, req);
        return response_dto_1.ApiResponse.ok(data, 'Cliente actualizado');
    }
    async cambiarEstado(id, dto, user, req) {
        const data = await this.clientesSvc.cambiarEstado(id, dto, user, false, req);
        return response_dto_1.ApiResponse.ok(data, `Estado cambiado a ${dto.estado}`);
    }
    async getHistorial(id, user) {
        const data = await this.clientesSvc.getHistorial(id, user.empresaId);
        return response_dto_1.ApiResponse.ok(data);
    }
    async subirFoto(id, file, user, req) {
        if (!file)
            throw new Error('No se recibió ningún archivo');
        const fotoUrl = await this.procesarFoto(id, file, user.empresaId);
        await this.clientesSvc.update(id, { fotoUrl }, user, req);
        return response_dto_1.ApiResponse.ok({ fotoUrl }, 'Foto actualizada correctamente');
    }
    async remove(id, user, req) {
        await this.clientesSvc.remove(id, user, req);
    }
    async procesarFoto(clienteId, file, empresaId) {
        const sharp = await Promise.resolve().then(() => require('sharp'));
        const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
        const fs = await Promise.resolve().then(() => require('fs/promises'));
        const path = await Promise.resolve().then(() => require('path'));
        const dir = path.join(uploadDir, 'clientes', empresaId);
        await fs.mkdir(dir, { recursive: true });
        const filename = `${clienteId}_${Date.now()}.webp`;
        const filepath = path.join(dir, filename);
        await sharp.default(file.buffer)
            .resize(400, 400, { fit: 'cover', position: 'face' })
            .webp({ quality: 85 })
            .toFile(filepath);
        return `/uploads/clientes/${empresaId}/${filename}`;
    }
};
exports.ClientesController = ClientesController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.RequirePermission)('clientes:create'),
    (0, swagger_1.ApiOperation)({
        summary: 'Crear nuevo cliente',
        description: 'Registra un cliente. Si el documento ya existe en la empresa devuelve 409.',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Cliente creado correctamente' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Documento duplicado en la empresa' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [cliente_dto_1.CreateClienteDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.RequirePermission)('clientes:view'),
    (0, swagger_1.ApiOperation)({
        summary: 'Listar clientes con filtros y paginación',
        description: 'Soporta búsqueda de texto libre sobre nombre, documento, email, teléfono y dirección. ' +
            'Acepta filtros por estado, tipo de servicio, distrito, fechas, etiquetas y más.',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lista paginada de clientes' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [cliente_dto_1.FilterClienteDto, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('resumen'),
    (0, roles_decorator_1.RequirePermission)('clientes:view'),
    (0, common_2.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Resumen de clientes por estado (dashboard)' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "getResumen", null);
__decorate([
    (0, common_1.Get)('mapa'),
    (0, roles_decorator_1.RequirePermission)('clientes:view'),
    (0, common_2.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Clientes con coordenadas GPS para el mapa' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "getMapa", null);
__decorate([
    (0, common_1.Get)('exportar'),
    (0, roles_decorator_1.RequirePermission)('clientes:export'),
    (0, swagger_1.ApiOperation)({
        summary: 'Exportar clientes a CSV o XLSX',
        description: 'Aplica los mismos filtros que el listado. Máximo 10.000 registros.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'formato', enum: ['csv', 'xlsx'], required: false }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [cliente_dto_1.ExportClientesDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "exportar", null);
__decorate([
    (0, common_1.Post)('reniec'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, roles_decorator_1.RequirePermission)('clientes:create'),
    (0, common_2.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Consultar datos de RENIEC por DNI',
        description: 'Retorna nombres y apellidos del titular. Los datos se cachean 24h. ' +
            'Si el servicio no está disponible retorna 503.',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Datos del titular del DNI' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'DNI inválido (debe tener 8 dígitos)' }),
    (0, swagger_1.ApiResponse)({ status: 503, description: 'Servicio RENIEC no disponible' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [cliente_dto_1.ConsultarReniecDto]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "consultarReniec", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.RequirePermission)('clientes:view'),
    (0, common_2.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener datos completos de un cliente' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del cliente' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Datos del cliente' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Cliente no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, roles_decorator_1.RequirePermission)('clientes:edit'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar datos completos de un cliente' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del cliente' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, cliente_dto_1.UpdateClienteDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.RequirePermission)('clientes:edit'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar campos específicos de un cliente' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del cliente' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, cliente_dto_1.UpdateClienteDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "patch", null);
__decorate([
    (0, common_1.Patch)(':id/estado'),
    (0, roles_decorator_1.RequirePermission)('clientes:edit'),
    (0, swagger_1.ApiOperation)({
        summary: 'Cambiar estado del cliente',
        description: 'Respeta la máquina de estados: no se puede ir de BAJA_DEFINITIVA a ACTIVO, etc. ' +
            'El cambio queda registrado en el historial de estados.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del cliente' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Estado cambiado correctamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Transición de estado no permitida' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, cliente_dto_1.CambiarEstadoDto, Object, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "cambiarEstado", null);
__decorate([
    (0, common_1.Get)(':id/historial'),
    (0, roles_decorator_1.RequirePermission)('clientes:view'),
    (0, common_2.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Historial de cambios de estado del cliente' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del cliente' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "getHistorial", null);
__decorate([
    (0, common_1.Post)(':id/foto'),
    (0, roles_decorator_1.RequirePermission)('clientes:edit'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('foto', {
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_, file, cb) => {
            const allowed = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowed.includes(file.mimetype)) {
                cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'), false);
            }
            else {
                cb(null, true);
            }
        },
    })),
    (0, swagger_1.ApiOperation)({ summary: 'Subir foto del cliente' }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del cliente' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "subirFoto", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.RequirePermission)('clientes:delete'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({
        summary: 'Eliminar cliente (soft delete)',
        description: 'Solo se puede eliminar un cliente que NO esté activo.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del cliente' }),
    (0, swagger_1.ApiResponse)({ status: 204, description: 'Cliente eliminado' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'No se puede eliminar cliente activo' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ClientesController.prototype, "remove", null);
exports.ClientesController = ClientesController = ClientesController_1 = __decorate([
    (0, swagger_1.ApiTags)('Clientes'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('clientes'),
    __metadata("design:paramtypes", [clientes_service_1.ClientesService])
], ClientesController);
//# sourceMappingURL=clientes.controller.js.map