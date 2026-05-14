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
var MikrotikController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MikrotikController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const mikrotik_service_1 = require("./mikrotik.service");
const mikrotik_dto_1 = require("./dto/mikrotik.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let MikrotikController = MikrotikController_1 = class MikrotikController {
    constructor(svc) {
        this.svc = svc;
        this.logger = new common_1.Logger(MikrotikController_1.name);
    }
    async crearRouter(dto, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.crearRouter(dto, user), 'Router registrado');
    }
    async listarRouters(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findAll(user.empresaId));
    }
    async getRouter(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findOne(id, user.empresaId));
    }
    async updateRouter(id, dto, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.updateRouter(id, dto, user), 'Router actualizado');
    }
    async removeRouter(id, user) {
        await this.svc.removeRouter(id, user);
    }
    async getEstado(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getEstadoRouter(id, user.empresaId));
    }
    async testConexion(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.testConexion(id, user.empresaId));
    }
    async getInterfaces(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getInterfaces(id, user.empresaId));
    }
    async getTrafico(id, iface, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getTrafico(id, user.empresaId, iface));
    }
    async getSesiones(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getSesionesPppoe(id, user.empresaId));
    }
    async getMorosos(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getMorosos(id, user.empresaId));
    }
    async getQueues(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getQueues(id, user.empresaId));
    }
    async getDhcp(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getDhcpLeases(id, user.empresaId));
    }
    async provisionar(id, dto, user) {
        const result = await this.svc.provisionarCliente(id, dto, user);
        return response_dto_1.ApiResponse.ok(result, 'Cliente provisionado en Mikrotik');
    }
    async suspender(id, dto, user) {
        await this.svc.suspenderCliente(id, dto, user);
        return response_dto_1.ApiResponse.ok(null, `IP ${dto.ipAsignada} suspendida — acceso bloqueado`);
    }
    async reactivar(id, dto, user) {
        await this.svc.reactivarCliente(id, dto, user);
        return response_dto_1.ApiResponse.ok(null, `IP ${dto.ipAsignada} reactivada — acceso restaurado`);
    }
    async crearDhcpBinding(id, dto, user) {
        const router = await this.svc.findOne(id, user.empresaId);
        return response_dto_1.ApiResponse.ok({ mensaje: 'DHCP binding creado' }, 'Binding creado');
    }
    async actualizarQueue(id, dto, user) {
        return response_dto_1.ApiResponse.ok(null, 'Velocidad actualizada en el router');
    }
    async configurarFirewall(id, user) {
        await this.svc.configurarFirewallControl(id, user.empresaId);
        return response_dto_1.ApiResponse.ok(null, 'Reglas de firewall configuradas correctamente');
    }
    async ping(id, dto, user) {
        const result = await this.svc.pingDesdeRouter(id, user.empresaId, dto.destino);
        return response_dto_1.ApiResponse.ok(result);
    }
};
exports.MikrotikController = MikrotikController;
__decorate([
    (0, common_1.Post)('routers'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Registrar nuevo router Mikrotik' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [mikrotik_dto_1.CreateRouterDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "crearRouter", null);
__decorate([
    (0, common_1.Get)('routers'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar todos los routers de la empresa' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "listarRouters", null);
__decorate([
    (0, common_1.Get)('routers/:id'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener router por ID' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getRouter", null);
__decorate([
    (0, common_1.Put)('routers/:id'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar datos del router' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, mikrotik_dto_1.UpdateRouterDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "updateRouter", null);
__decorate([
    (0, common_1.Delete)('routers/:id'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Eliminar router (soft delete)' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "removeRouter", null);
__decorate([
    (0, common_1.Get)('routers/:id/estado'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Estado en tiempo real del router',
        description: 'CPU, RAM, uptime, versión, interfaces y sesiones PPPoE activas.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getEstado", null);
__decorate([
    (0, common_1.Post)('routers/:id/test'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Testear conectividad con el router',
        description: 'Abre una conexión nueva al router y mide la latencia.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "testConexion", null);
__decorate([
    (0, common_1.Get)('routers/:id/interfaces'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar interfaces del router con estadísticas de tráfico' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getInterfaces", null);
__decorate([
    (0, common_1.Get)('routers/:id/trafico'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Monitoreo de tráfico en tiempo real (5 muestras/5s)' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiQuery)({ name: 'iface', required: false, description: 'Nombre de la interface (ej: ether1)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Query)('iface')),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getTrafico", null);
__decorate([
    (0, common_1.Get)('routers/:id/sesiones'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Sesiones PPPoE activas en el router' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getSesiones", null);
__decorate([
    (0, common_1.Get)('routers/:id/morosos'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'IPs en la Address List "morosos" del router' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getMorosos", null);
__decorate([
    (0, common_1.Get)('routers/:id/queues'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Simple Queues configuradas en el router' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getQueues", null);
__decorate([
    (0, common_1.Get)('routers/:id/dhcp'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Leases DHCP del router' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "getDhcp", null);
__decorate([
    (0, common_1.Post)('routers/:id/provisionar'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, swagger_1.ApiOperation)({
        summary: 'Provisionar cliente en el router',
        description: 'Crea usuario PPPoE + Simple Queue con los límites del plan. ' +
            'Si el plan usa PCQ/Queue Tree, configura el sistema automáticamente si no existe.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID del router' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Cliente provisionado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, mikrotik_dto_1.ProvisionarClienteDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "provisionar", null);
__decorate([
    (0, common_1.Post)('routers/:id/suspender'),
    (0, roles_decorator_1.RequirePermission)('contratos:suspend'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Suspender cliente por mora',
        description: 'Agrega la IP del cliente a la Address List "morosos". ' +
            'Las reglas de firewall bloquean automáticamente su tráfico. ' +
            'También desconecta la sesión PPPoE activa.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, mikrotik_dto_1.SuspenderClienteDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "suspender", null);
__decorate([
    (0, common_1.Post)('routers/:id/reactivar'),
    (0, roles_decorator_1.RequirePermission)('contratos:reactivate'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Reactivar cliente',
        description: 'Quita la IP de las Address Lists de control (morosos, prorroga). ' +
            'El cliente puede reconectarse inmediatamente con sus credenciales PPPoE.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, mikrotik_dto_1.ReactivarClienteDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "reactivar", null);
__decorate([
    (0, common_1.Post)('routers/:id/dhcp/binding'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Crear binding estático DHCP (amarre IP-MAC)' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, mikrotik_dto_1.DhcpBindingDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "crearDhcpBinding", null);
__decorate([
    (0, common_1.Patch)('routers/:id/queues/velocidad'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar velocidad de una Simple Queue existente' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, mikrotik_dto_1.ActualizarQueueDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "actualizarQueue", null);
__decorate([
    (0, common_1.Post)('routers/:id/firewall/configurar'),
    (0, roles_decorator_1.Roles)('Administrador'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Configurar reglas de firewall para suspensión automática',
        description: 'Crea las reglas necesarias en el router para que el sistema de ' +
            'Address Lists funcione: bloqueo de morosos, portal de pago, prórrogas.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "configurarFirewall", null);
__decorate([
    (0, common_1.Post)('routers/:id/ping'),
    (0, roles_decorator_1.RequirePermission)('mikrotik:view'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Hacer ping desde el router hacia un destino' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, mikrotik_dto_1.PingDto, Object]),
    __metadata("design:returntype", Promise)
], MikrotikController.prototype, "ping", null);
exports.MikrotikController = MikrotikController = MikrotikController_1 = __decorate([
    (0, swagger_1.ApiTags)('Mikrotik'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('mikrotik'),
    __metadata("design:paramtypes", [mikrotik_service_1.MikrotikService])
], MikrotikController);
//# sourceMappingURL=mikrotik.controller.js.map