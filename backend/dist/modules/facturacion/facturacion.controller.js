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
var FacturacionController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacturacionController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const throttler_1 = require("@nestjs/throttler");
const facturacion_service_1 = require("./facturacion.service");
const factura_dto_1 = require("./dto/factura.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let FacturacionController = FacturacionController_1 = class FacturacionController {
    constructor(svc) {
        this.svc = svc;
        this.logger = new common_1.Logger(FacturacionController_1.name);
    }
    async create(dto, user, req) {
        const f = await this.svc.create(dto, user, req);
        return response_dto_1.ApiResponse.ok(f, 'Factura emitida correctamente');
    }
    async generarMensual(dto, user, req) {
        const resultado = await this.svc.generarMensual(dto, user, req);
        return response_dto_1.ApiResponse.ok(resultado, `Generación completada: ${resultado.exitosas} facturas creadas, ${resultado.omitidas} omitidas`);
    }
    async findAll(filters, user) {
        const r = await this.svc.findAll(user.empresaId, filters);
        return response_dto_1.ApiResponse.ok(r.data, 'Facturas obtenidas', { meta: r.meta });
    }
    async getResumen(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getResumenFinanciero(user.empresaId));
    }
    async findByContrato(contratoId, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findByContrato(contratoId, user.empresaId));
    }
    async findByCliente(clienteId, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findByCliente(clienteId, user.empresaId));
    }
    async findOne(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findOne(id, user.empresaId));
    }
    async descargarPdf(id, user, res) {
        const factura = await this.svc.findOne(id, user.empresaId);
        if (!factura.pdfUrl) {
            const regenerada = await this.svc.regenerarPdf(id, user.empresaId);
            if (!regenerada.pdfUrl) {
                return res.status(202).json({ message: 'PDF en generación — intenta en unos segundos' });
            }
            return res.redirect(regenerada.pdfUrl);
        }
        return res.redirect(factura.pdfUrl);
    }
    async regenerarPdf(id, user) {
        const f = await this.svc.regenerarPdf(id, user.empresaId);
        return response_dto_1.ApiResponse.ok({ pdfUrl: f.pdfUrl }, 'PDF regenerado');
    }
    async crearNotaCredito(id, dto, user, req) {
        const nc = await this.svc.crearNotaCredito({ ...dto, facturaOriginalId: id }, user, req);
        return response_dto_1.ApiResponse.ok(nc, 'Nota de crédito emitida');
    }
    async anular(id, dto, user, req) {
        const result = await this.svc.anular(id, dto, user, req);
        const msg = result.notaCredito
            ? `Factura anulada. Nota de crédito: ${result.notaCredito.numeroCompleto}`
            : 'Factura anulada';
        return response_dto_1.ApiResponse.ok(result, msg);
    }
    async marcarVencidas(user) {
        const count = await this.svc.marcarVencidas();
        return response_dto_1.ApiResponse.ok({ marcadas: count }, `${count} facturas marcadas como vencidas`);
    }
};
exports.FacturacionController = FacturacionController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.RequirePermission)('facturas:create'),
    (0, swagger_1.ApiOperation)({
        summary: 'Crear factura manual',
        description: 'Crea un comprobante de forma manual. Calcula IGV automáticamente. ' +
            'El PDF se genera de forma asíncrona.',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Factura creada' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [factura_dto_1.CreateFacturaDto, Object, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('generar-mensual'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, roles_decorator_1.Roles)('Administrador', 'Supervisor'),
    (0, throttler_1.Throttle)({ default: { limit: 1, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({
        summary: 'Generar facturas mensuales masivas',
        description: 'Crea facturas para todos los contratos activos del mes/año indicado. ' +
            'Es idempotente: omite contratos ya facturados en el periodo. ' +
            'Puede tomar varios segundos en empresas con muchos contratos.',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Resultado de la generación masiva' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [factura_dto_1.GenerarFacturasMensualesDto, Object, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "generarMensual", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.RequirePermission)('facturas:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar facturas con filtros y paginación' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [factura_dto_1.FilterFacturaDto, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('resumen'),
    (0, roles_decorator_1.RequirePermission)('reports:financial'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Resumen financiero del mes actual',
        description: 'Retorna: facturado, cobrado, cuentas por cobrar, facturas vencidas, tasa de cobranza.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "getResumen", null);
__decorate([
    (0, common_1.Get)('contrato/:contratoId'),
    (0, roles_decorator_1.RequirePermission)('facturas:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Facturas de un contrato específico' }),
    (0, swagger_1.ApiParam)({ name: 'contratoId' }),
    __param(0, (0, common_1.Param)('contratoId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "findByContrato", null);
__decorate([
    (0, common_1.Get)('cliente/:clienteId'),
    (0, roles_decorator_1.RequirePermission)('facturas:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Facturas de un cliente específico (últimas 50)' }),
    (0, swagger_1.ApiParam)({ name: 'clienteId' }),
    __param(0, (0, common_1.Param)('clienteId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "findByCliente", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.RequirePermission)('facturas:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener factura por ID' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)(':id/pdf'),
    (0, roles_decorator_1.RequirePermission)('facturas:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Descargar PDF de la factura',
        description: 'Si el PDF no existe se regenera. Redirige al archivo.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "descargarPdf", null);
__decorate([
    (0, common_1.Post)(':id/pdf'),
    (0, roles_decorator_1.RequirePermission)('facturas:view'),
    (0, swagger_1.ApiOperation)({ summary: 'Forzar regeneración del PDF de la factura' }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "regenerarPdf", null);
__decorate([
    (0, common_1.Post)(':id/nota-credito'),
    (0, roles_decorator_1.RequirePermission)('facturas:create'),
    (0, swagger_1.ApiOperation)({
        summary: 'Emitir nota de crédito',
        description: 'Crea una nota de crédito referenciando la factura original. ' +
            'Útil para rectificar montos sin anular el comprobante.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID de la factura original' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "crearNotaCredito", null);
__decorate([
    (0, common_1.Patch)(':id/anular'),
    (0, roles_decorator_1.RequirePermission)('facturas:delete'),
    (0, swagger_1.ApiOperation)({
        summary: 'Anular factura',
        description: 'Solo facturas en estado emitida/vencida/en_cobranza. ' +
            'No se puede anular una factura pagada (usar nota de crédito). ' +
            'Por defecto genera una nota de crédito automáticamente.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Factura ya anulada o pagada' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, factura_dto_1.AnularFacturaDto, Object, Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "anular", null);
__decorate([
    (0, common_1.Patch)('admin/marcar-vencidas'),
    (0, roles_decorator_1.Roles)('Administrador'),
    (0, swagger_1.ApiOperation)({
        summary: 'Marcar facturas vencidas (admin)',
        description: 'Normalmente ejecutado por el cron. Disponible para ejecución manual.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FacturacionController.prototype, "marcarVencidas", null);
exports.FacturacionController = FacturacionController = FacturacionController_1 = __decorate([
    (0, swagger_1.ApiTags)('Facturación'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('facturacion'),
    __metadata("design:paramtypes", [facturacion_service_1.FacturacionService])
], FacturacionController);
//# sourceMappingURL=facturacion.controller.js.map