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
var SmartoltController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartoltController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const smartolt_service_1 = require("./smartolt.service");
const orquestador_ftth_service_1 = require("./orquestador-ftth.service");
const smartolt_dto_1 = require("./dto/smartolt.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let SmartoltController = SmartoltController_1 = class SmartoltController {
    constructor(svc, orquestador) {
        this.svc = svc;
        this.orquestador = orquestador;
        this.logger = new common_1.Logger(SmartoltController_1.name);
    }
    async health(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.verificarSmartolt());
    }
    async crearOlt(dto, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.crearOlt(dto, user), 'OLT registrado');
    }
    async listarOlts(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findAllOlts(user.empresaId));
    }
    async getOlt(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findOneOlt(id, user.empresaId));
    }
    async updateOlt(id, dto, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.updateOlt(id, dto, user), 'OLT actualizado');
    }
    async sincronizarOlts(user) {
        const r = await this.svc.sincronizarOltsDesdeSmartolt(user);
        return response_dto_1.ApiResponse.ok(r, `${r.sincronizados} OLTs sincronizados`);
    }
    async getEstadisticasOlt(id, user) {
        const olt = await this.svc.findOneOlt(id, user.empresaId);
        const stats = await this.svc['smartoltApi']?.getEstadisticasOlt?.(olt.smartoltId || '').catch(() => null);
        return response_dto_1.ApiResponse.ok(stats);
    }
    async listarNoAprovisionadas(oltId, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.listarNoAprovisionadas(user.empresaId, oltId));
    }
    async provisionar(dto, user, req) {
        const onu = await this.svc.aprovisionarOnu(dto, user, req);
        return response_dto_1.ApiResponse.ok(onu, `ONU ${dto.serialNumber} aprovisionada correctamente`);
    }
    async flujoCompleto(dto, user) {
        this.logger.log(`Flujo FTTH iniciado: contrato=${dto.contratoId} | por: ${user.email}`);
        const resultado = await this.orquestador.ejecutarFlujoComipletoFtth(dto, user);
        return response_dto_1.ApiResponse.ok(resultado, resultado.mensajeFinal);
    }
    async findAll(filters, user) {
        const r = await this.svc.findAll(user.empresaId, filters);
        return response_dto_1.ApiResponse.ok(r.data, 'ONUs obtenidas', { meta: r.meta });
    }
    async getResumen(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getResumen(user.empresaId));
    }
    async findOne(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findOnuCompleta(id, user.empresaId));
    }
    async getSeñal(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getSeñalOnu(id, user.empresaId));
    }
    async reiniciar(id, user) {
        await this.svc.reiniciarOnu(id, user);
        return response_dto_1.ApiResponse.ok(null, 'ONU reiniciada');
    }
    async eliminarProvision(id, user, req) {
        await this.svc.eliminarProvision(id, user, req);
        return response_dto_1.ApiResponse.ok(null, 'Provisión eliminada — ONU queda disponible para re-aprovisionar');
    }
    async asociarContrato(dto, user) {
        await this.svc.asociarAContrato(dto, user);
        return response_dto_1.ApiResponse.ok(null, `ONU ${dto.onuId} asociada al contrato ${dto.contratoId}`);
    }
    async sincronizarEstado(oltId, user) {
        const r = await this.svc.sincronizarEstadoOnus(user.empresaId, oltId);
        return response_dto_1.ApiResponse.ok(r, `${r.actualizadas} ONUs sincronizadas: ${r.online} online, ${r.offline} offline`);
    }
    async listarPerfiles(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.listarPerfiles());
    }
};
exports.SmartoltController = SmartoltController;
__decorate([
    (0, common_1.Get)('health'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Verificar conectividad con SmartOLT' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "health", null);
__decorate([
    (0, common_1.Post)('olts'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, swagger_1.ApiOperation)({ summary: 'Registrar un OLT en el sistema' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [smartolt_dto_1.CreateOltDto, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "crearOlt", null);
__decorate([
    (0, common_1.Get)('olts'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar OLTs de la empresa' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "listarOlts", null);
__decorate([
    (0, common_1.Get)('olts/:id'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "getOlt", null);
__decorate([
    (0, common_1.Put)('olts/:id'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, smartolt_dto_1.UpdateOltDto, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "updateOlt", null);
__decorate([
    (0, common_1.Post)('olts/sincronizar'),
    (0, roles_decorator_1.Roles)('Administrador', 'Supervisor'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Sincronizar OLTs desde SmartOLT',
        description: 'Importa todos los OLTs registrados en SmartOLT al sistema.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "sincronizarOlts", null);
__decorate([
    (0, common_1.Get)('olts/:id/estadisticas'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiOperation)({ summary: 'Estadísticas del OLT en SmartOLT (ONUs online/offline, potencia)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "getEstadisticasOlt", null);
__decorate([
    (0, common_1.Get)('onus/sin-aprovisionar'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'ONUs detectadas sin aprovisionar',
        description: 'Consulta SmartOLT y retorna ONUs conectadas pero sin perfil. Filtrar por OLT.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'oltId', required: false }),
    __param(0, (0, common_1.Query)('oltId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "listarNoAprovisionadas", null);
__decorate([
    (0, common_1.Post)('onus/provisionar'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, swagger_1.ApiOperation)({
        summary: 'Aprovisionar una ONU individual',
        description: 'Registra la ONU en SmartOLT con SN, PON, perfil y VLAN. ' +
            'Luego la guarda en la BD y la asocia al contrato si se indica.',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'ONU aprovisionada' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'ONU ya aprovisionada con ese SN' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [smartolt_dto_1.ProvisionarOnuDto, Object, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "provisionar", null);
__decorate([
    (0, common_1.Post)('ftth/aprovisionamiento-completo'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: '🚀 Flujo completo FTTH — 8 pasos automáticos',
        description: `Ejecuta secuencialmente:
1. Validar contrato, cliente y plan
2. Asignar IP del pool (si no tiene)
3. Detectar ONU no aprovisionada en SmartOLT
4. Aprovisionar ONU (SN + PON + perfil + VLAN)
5. Registrar ONU en BD y asociar al contrato
6. Crear usuario PPPoE en Mikrotik
7. Aplicar control de velocidad (Simple Queue / Queue Tree / PCQ)
8. Activar contrato y notificar al cliente por WhatsApp

Si algún paso falla, los siguientes se marcan como omitidos y el resultado incluye el detalle del error.`,
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Resultado de los 8 pasos del flujo FTTH' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [smartolt_dto_1.FlujoComipletoFtthDto, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "flujoCompleto", null);
__decorate([
    (0, common_1.Get)('onus'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar ONUs con filtros y paginación' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [smartolt_dto_1.FilterOnuDto, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('onus/resumen'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Resumen de ONUs por estado' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "getResumen", null);
__decorate([
    (0, common_1.Get)('onus/:id'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiOperation)({ summary: 'Datos completos de una ONU (con OLT, contrato y cliente)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('onus/:id/senal'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiOperation)({ summary: 'Señal óptica en tiempo real (dBm, temperatura, voltaje)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "getSe\u00F1al", null);
__decorate([
    (0, common_1.Post)('onus/:id/reiniciar'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiOperation)({ summary: 'Reiniciar una ONU remotamente' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "reiniciar", null);
__decorate([
    (0, common_1.Post)('onus/:id/eliminar-provision'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiOperation)({
        summary: 'Eliminar provisión de la ONU en SmartOLT',
        description: 'Desasocia la ONU del contrato y la elimina del OLT en SmartOLT. La ONU queda "sin aprovisionar".',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "eliminarProvision", null);
__decorate([
    (0, common_1.Post)('onus/asociar-contrato'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Asociar ONU existente a un contrato' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [smartolt_dto_1.AsociarOnuContratoDto, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "asociarContrato", null);
__decorate([
    (0, common_1.Post)('onus/sincronizar/:oltId'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiParam)({ name: 'oltId' }),
    (0, swagger_1.ApiOperation)({
        summary: 'Sincronizar estado de ONUs desde SmartOLT',
        description: 'Actualiza el estado online/offline y señal óptica de todas las ONUs del OLT.',
    }),
    __param(0, (0, common_1.Param)('oltId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "sincronizarEstado", null);
__decorate([
    (0, common_1.Get)('perfiles'),
    (0, roles_decorator_1.RequirePermission)('onu:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar perfiles de servicio disponibles en SmartOLT' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SmartoltController.prototype, "listarPerfiles", null);
exports.SmartoltController = SmartoltController = SmartoltController_1 = __decorate([
    (0, swagger_1.ApiTags)('FTTH — SmartOLT'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('smartolt'),
    __metadata("design:paramtypes", [smartolt_service_1.SmartoltService,
        orquestador_ftth_service_1.OrquestadorFtthService])
], SmartoltController);
//# sourceMappingURL=smartolt.controller.js.map