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
var MonitoreoController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoreoController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_2 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const bull_1 = require("@nestjs/bull");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const alertas_service_1 = require("./services/alertas.service");
const ping_service_1 = require("./services/ping.service");
const snmp_service_1 = require("./services/snmp.service");
const monitoreo_gateway_1 = require("./gateways/monitoreo.gateway");
const monitoreo_entity_1 = require("./entities/monitoreo.entity");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
const monitoreo_worker_1 = require("./monitoreo.worker");
class CreateNodoDto {
}
__decorate([
    (0, swagger_2.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateNodoDto.prototype, "nombre", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateNodoDto.prototype, "descripcion", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ enum: monitoreo_entity_1.TipoNodo }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(monitoreo_entity_1.TipoNodo),
    __metadata("design:type", String)
], CreateNodoDto.prototype, "tipo", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateNodoDto.prototype, "routerId", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateNodoDto.prototype, "oltId", void 0);
__decorate([
    (0, swagger_2.ApiProperty)({ example: '192.168.100.1' }),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], CreateNodoDto.prototype, "ipMonitoreo", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateNodoDto.prototype, "snmpHabilitado", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: 'public' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateNodoDto.prototype, "snmpCommunity", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: 2 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateNodoDto.prototype, "snmpVersion", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateNodoDto.prototype, "snmpInterfaceIndex", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateNodoDto.prototype, "pingHabilitado", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: 60 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(10),
    (0, class_validator_1.Max)(3600),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateNodoDto.prototype, "pingIntervaloSeg", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateNodoDto.prototype, "latitud", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateNodoDto.prototype, "longitud", void 0);
class CreateConfigAlertaDto {
}
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateConfigAlertaDto.prototype, "nodoId", void 0);
__decorate([
    (0, swagger_2.ApiProperty)({ enum: monitoreo_entity_1.MetricaAlerta }),
    (0, class_validator_1.IsEnum)(monitoreo_entity_1.MetricaAlerta),
    __metadata("design:type", String)
], CreateConfigAlertaDto.prototype, "metrica", void 0);
__decorate([
    (0, swagger_2.ApiProperty)({ example: 80 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateConfigAlertaDto.prototype, "umbralWarning", void 0);
__decorate([
    (0, swagger_2.ApiProperty)({ example: 95 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateConfigAlertaDto.prototype, "umbralCritical", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateConfigAlertaDto.prototype, "notificarWhatsapp", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateConfigAlertaDto.prototype, "telefonoDestino", void 0);
let MonitoreoController = MonitoreoController_1 = class MonitoreoController {
    constructor(nodoRepo, medicionRepo, configRepo, queue, alertasSvc, pingSvc, snmpSvc, gateway) {
        this.nodoRepo = nodoRepo;
        this.medicionRepo = medicionRepo;
        this.configRepo = configRepo;
        this.queue = queue;
        this.alertasSvc = alertasSvc;
        this.pingSvc = pingSvc;
        this.snmpSvc = snmpSvc;
        this.gateway = gateway;
        this.logger = new common_1.Logger(MonitoreoController_1.name);
    }
    async crearNodo(dto, user) {
        const nodo = await this.nodoRepo.save(this.nodoRepo.create({ ...dto, empresaId: user.empresaId }));
        return response_dto_1.ApiResponse.ok(nodo, 'Nodo registrado para monitoreo');
    }
    async listarNodos(user) {
        const nodos = await this.nodoRepo.find({
            where: { empresaId: user.empresaId, activo: true },
            order: { tipo: 'ASC', nombre: 'ASC' },
        });
        return response_dto_1.ApiResponse.ok(nodos);
    }
    async getNodo(id, user) {
        const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
        if (!nodo)
            return response_dto_1.ApiResponse.ok(null, 'Nodo no encontrado');
        return response_dto_1.ApiResponse.ok(nodo);
    }
    async updateNodo(id, dto, user) {
        await this.nodoRepo.update({ id, empresaId: user.empresaId }, dto);
        const nodo = await this.nodoRepo.findOne({ where: { id } });
        return response_dto_1.ApiResponse.ok(nodo, 'Nodo actualizado');
    }
    async deleteNodo(id, user) {
        await this.nodoRepo.update({ id, empresaId: user.empresaId }, { activo: false, deletedAt: new Date() });
    }
    async pingNodo(id, user) {
        const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
        if (!nodo)
            return response_dto_1.ApiResponse.ok(null, 'Nodo no encontrado');
        const result = await this.pingSvc.ping(nodo.ipMonitoreo, 4, nodo.pingTimeoutMs || 3000);
        return response_dto_1.ApiResponse.ok(result);
    }
    async pingIp(body, user) {
        const result = await this.pingSvc.ping(body.ip, body.count || 4, 5000);
        return response_dto_1.ApiResponse.ok(result);
    }
    async getMediciones(id, horas, user) {
        const horasNum = Math.min(parseInt(horas || '24', 10), 168);
        const mediciones = await this.medicionRepo
            .createQueryBuilder('m')
            .where('m.nodo_id = :id', { id })
            .andWhere('m.empresa_id = :empresaId', { empresaId: user.empresaId })
            .andWhere(`m.timestamp >= NOW() - INTERVAL '${horasNum} hours'`)
            .orderBy('m.timestamp', 'ASC')
            .getMany();
        return response_dto_1.ApiResponse.ok(mediciones);
    }
    async getSnmpInterfaces(id, user) {
        const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
        if (!nodo?.snmpHabilitado)
            return response_dto_1.ApiResponse.ok([], 'SNMP no habilitado en este nodo');
        const interfaces = await this.snmpSvc.getInterfaces(nodo.ipMonitoreo, nodo.snmpCommunity, nodo.snmpVersion);
        return response_dto_1.ApiResponse.ok(interfaces);
    }
    async testSnmp(id, user) {
        const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
        if (!nodo)
            return response_dto_1.ApiResponse.ok({ conectado: false }, 'Nodo no encontrado');
        const conectado = await this.snmpSvc.testConnection(nodo.ipMonitoreo, nodo.snmpCommunity, nodo.snmpVersion);
        return response_dto_1.ApiResponse.ok({ conectado, ip: nodo.ipMonitoreo, community: nodo.snmpCommunity });
    }
    async getDashboard(user) {
        const [nodos, alertasResumen, colaStats] = await Promise.all([
            this.nodoRepo.find({ where: { empresaId: user.empresaId, activo: true } }),
            this.alertasSvc.getResumenAlertas(user.empresaId),
            this.queue.getJobCounts(),
        ]);
        const porEstado = nodos.reduce((acc, n) => {
            acc[n.estado] = (acc[n.estado] || 0) + 1;
            return acc;
        }, {});
        const wsStats = this.gateway.getStats();
        return response_dto_1.ApiResponse.ok({
            nodos: { total: nodos.length, porEstado },
            alertas: alertasResumen,
            websocket: wsStats,
            cola: colaStats,
            timestamp: new Date().toISOString(),
        });
    }
    async getAlertas(user) {
        return response_dto_1.ApiResponse.ok(await this.alertasSvc.getAlertasActivas(user.empresaId));
    }
    async getHistorialAlertas(nodoId, user) {
        return response_dto_1.ApiResponse.ok(await this.alertasSvc.getHistorialAlertas(user.empresaId, nodoId, 100));
    }
    async resolverAlerta(id, body, user) {
        await this.alertasSvc.resolverAlerta(id, body.motivo || 'Resuelta manualmente', user.email);
        return response_dto_1.ApiResponse.ok(null, 'Alerta resuelta');
    }
    async crearConfigAlerta(dto, user) {
        const config = await this.configRepo.save(this.configRepo.create({ ...dto, empresaId: user.empresaId }));
        return response_dto_1.ApiResponse.ok(config, 'Configuración de alerta creada');
    }
    async getConfigAlertas(user) {
        const configs = await this.configRepo.find({
            where: { empresaId: user.empresaId, activo: true },
            order: { metrica: 'ASC' },
        });
        return response_dto_1.ApiResponse.ok(configs);
    }
    async deleteConfigAlerta(id, user) {
        await this.configRepo.update({ id, empresaId: user.empresaId }, { activo: false });
    }
    async getWsStats(user) {
        return response_dto_1.ApiResponse.ok(this.gateway.getStats());
    }
    async forzarScan(user) {
        const nodos = await this.nodoRepo.find({
            where: { empresaId: user.empresaId, activo: true, pingHabilitado: true },
        });
        await this.queue.add(monitoreo_worker_1.JOB_PING_BATCH, {
            empresaId: user.empresaId,
            nodos: nodos.map((n) => ({
                id: n.id, ip: n.ipMonitoreo, nombre: n.nombre,
                tipo: n.tipo, pingTimeoutMs: n.pingTimeoutMs,
                pingReintentos: n.pingReintentos, estadoActual: n.estado,
                alertasHabilitadas: n.alertasHabilitadas,
            })),
        }, { priority: 1 });
        return response_dto_1.ApiResponse.ok({ encolados: nodos.length }, `${nodos.length} nodos encolados para scan inmediato`);
    }
};
exports.MonitoreoController = MonitoreoController;
__decorate([
    (0, common_1.Post)('nodos'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Registrar nodo/equipo para monitoreo' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateNodoDto, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "crearNodo", null);
__decorate([
    (0, common_1.Get)('nodos'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar nodos monitoreados con estado actual' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "listarNodos", null);
__decorate([
    (0, common_1.Get)('nodos/:id'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getNodo", null);
__decorate([
    (0, common_1.Put)('nodos/:id'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:manage'),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "updateNodo", null);
__decorate([
    (0, common_1.Delete)('nodos/:id'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:manage'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "deleteNodo", null);
__decorate([
    (0, common_1.Post)('nodos/:id/ping'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Ping manual inmediato a un nodo' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "pingNodo", null);
__decorate([
    (0, common_1.Post)('ping'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Ping inmediato a una IP (sin necesidad de tener el nodo registrado)' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "pingIp", null);
__decorate([
    (0, common_1.Get)('nodos/:id/mediciones'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Historial de mediciones de un nodo' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiQuery)({ name: 'horas', required: false, description: 'Últimas N horas (default: 24)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Query)('horas')),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getMediciones", null);
__decorate([
    (0, common_1.Get)('nodos/:id/snmp/interfaces'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar interfaces SNMP del nodo' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getSnmpInterfaces", null);
__decorate([
    (0, common_1.Get)('nodos/:id/snmp/test'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "testSnmp", null);
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Resumen del dashboard de monitoreo' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getDashboard", null);
__decorate([
    (0, common_1.Get)('alertas'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Alertas activas de la empresa' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getAlertas", null);
__decorate([
    (0, common_1.Get)('alertas/historial'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Historial de alertas' }),
    (0, swagger_1.ApiQuery)({ name: 'nodoId', required: false }),
    __param(0, (0, common_1.Query)('nodoId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getHistorialAlertas", null);
__decorate([
    (0, common_1.Patch)('alertas/:id/resolver'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:manage'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiOperation)({ summary: 'Resolver alerta manualmente' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "resolverAlerta", null);
__decorate([
    (0, common_1.Post)('alertas/configuracion'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Crear configuración de umbral de alerta' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateConfigAlertaDto, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "crearConfigAlerta", null);
__decorate([
    (0, common_1.Get)('alertas/configuracion'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getConfigAlertas", null);
__decorate([
    (0, common_1.Delete)('alertas/configuracion/:id'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:manage'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "deleteConfigAlerta", null);
__decorate([
    (0, common_1.Get)('ws/stats'),
    (0, roles_decorator_1.RequirePermission)('monitoreo:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Estadísticas del WebSocket Gateway de monitoreo' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "getWsStats", null);
__decorate([
    (0, common_1.Post)('scan'),
    (0, roles_decorator_1.Roles)('Administrador', 'Supervisor'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, swagger_1.ApiOperation)({ summary: 'Forzar ciclo de monitoreo inmediato (sin esperar el cron)' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoController.prototype, "forzarScan", null);
exports.MonitoreoController = MonitoreoController = MonitoreoController_1 = __decorate([
    (0, swagger_1.ApiTags)('Monitoreo'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('monitoreo'),
    __param(0, (0, typeorm_1.InjectRepository)(monitoreo_entity_1.Nodo)),
    __param(1, (0, typeorm_1.InjectRepository)(monitoreo_entity_1.MedicionNodo)),
    __param(2, (0, typeorm_1.InjectRepository)(monitoreo_entity_1.ConfiguracionAlerta)),
    __param(3, (0, bull_1.InjectQueue)(monitoreo_worker_1.MONITOREO_QUEUE)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository, Object, alertas_service_1.AlertasService,
        ping_service_1.PingService,
        snmp_service_1.SnmpService,
        monitoreo_gateway_1.MonitoreoGateway])
], MonitoreoController);
//# sourceMappingURL=monitoreo.controller.js.map