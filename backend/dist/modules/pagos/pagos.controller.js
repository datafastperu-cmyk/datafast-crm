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
var PagosController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagosController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const multer_1 = require("multer");
const pagos_service_1 = require("./pagos.service");
const pago_dto_1 = require("./dto/pago.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let PagosController = PagosController_1 = class PagosController {
    constructor(svc) {
        this.svc = svc;
        this.logger = new common_1.Logger(PagosController_1.name);
    }
    async registrar(dto, user, req) {
        const pago = await this.svc.registrar(dto, user, req);
        return response_dto_1.ApiResponse.ok(pago, pago.estado === 'verificado'
            ? 'Pago registrado y aplicado correctamente'
            : 'Pago registrado — pendiente de verificación');
    }
    async findAll(filters, user) {
        const r = await this.svc.findAll(user.empresaId, filters);
        return response_dto_1.ApiResponse.ok(r.data, 'Pagos obtenidos', { meta: r.meta });
    }
    async getResumen(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getResumen(user.empresaId));
    }
    async findPendientes(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findPendientes(user.empresaId));
    }
    async getCuentas(user) {
        return response_dto_1.ApiResponse.ok(await this.svc.getCuentasBancarias(user.empresaId));
    }
    async createCuenta(dto, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.createCuentaBancaria(dto, user), 'Cuenta registrada');
    }
    async crearPreferenciaMp(dto, user) {
        const preferencia = await this.svc.crearPreferenciaMp(dto, user);
        return response_dto_1.ApiResponse.ok(preferencia, 'Link de pago generado');
    }
    async webhookMercadoPago(body, req, xSignature, xRequestId) {
        this.logger.log(`Webhook MP: ${body.type} | action: ${body.action} | id: ${body.data?.id}`);
        await this.svc.procesarWebhookMercadoPago(body, req.rawBody || Buffer.from(JSON.stringify(body)), xSignature || '', xRequestId || '');
        return { received: true };
    }
    async findByFactura(facturaId, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findByFactura(facturaId, user.empresaId));
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
    async verificar(id, dto, user, req) {
        const pago = await this.svc.verificar(id, dto, user, req);
        return response_dto_1.ApiResponse.ok(pago, dto.aprobado
            ? 'Pago aprobado y aplicado — contrato reactivado si tenía mora'
            : 'Pago rechazado');
    }
    async conciliar(id, dto, user, req) {
        return response_dto_1.ApiResponse.ok(await this.svc.conciliar(id, dto, user, req), 'Pago conciliado');
    }
    async subirComprobante(id, file, user) {
        if (!file)
            throw new Error('No se recibió archivo');
        const pago = await this.svc.findOne(id, user.empresaId);
        const url = await this.guardarComprobante(file, user.empresaId, id);
        return response_dto_1.ApiResponse.ok({ comprobanteUrl: url }, 'Comprobante subido');
    }
    async guardarComprobante(file, empresaId, pagoId) {
        const sharp = await Promise.resolve().then(() => require('sharp'));
        const fs = await Promise.resolve().then(() => require('fs/promises'));
        const path = await Promise.resolve().then(() => require('path'));
        const dir = path.join(process.env.UPLOAD_DIR || '/app/uploads', 'comprobantes', empresaId);
        await fs.mkdir(dir, { recursive: true });
        const isPdf = file.mimetype === 'application/pdf';
        const ext = isPdf ? 'pdf' : 'webp';
        const fname = `${pagoId}_${Date.now()}.${ext}`;
        const fpath = path.join(dir, fname);
        if (isPdf) {
            await fs.writeFile(fpath, file.buffer);
        }
        else {
            await sharp.default(file.buffer)
                .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 85 })
                .toFile(fpath);
        }
        return `/uploads/comprobantes/${empresaId}/${fname}`;
    }
};
exports.PagosController = PagosController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.RequirePermission)('pagos:create'),
    (0, swagger_1.ApiOperation)({
        summary: 'Registrar pago',
        description: 'Registra un pago de cliente. Verifica duplicados por número de operación. ' +
            'Si el método es Efectivo o se marca autoVerificar=true, se aplica inmediatamente ' +
            'y dispara la reactivación automática del servicio si el contrato tenía mora.',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Pago registrado' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Duplicado — número de operación ya registrado' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [pago_dto_1.RegistrarPagoDto, Object, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "registrar", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.RequirePermission)('pagos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Listar pagos con filtros y paginación' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [pago_dto_1.FilterPagoDto, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('resumen'),
    (0, roles_decorator_1.RequirePermission)('pagos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Resumen de cobranza (dashboard)',
        description: 'Cobrado hoy/semana/mes, pagos por método, pendientes de verificar, últimos pagos.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "getResumen", null);
__decorate([
    (0, common_1.Get)('pendientes'),
    (0, roles_decorator_1.RequirePermission)('pagos:verify'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Pagos pendientes de verificación manual' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "findPendientes", null);
__decorate([
    (0, common_1.Get)('cuentas'),
    (0, roles_decorator_1.RequirePermission)('pagos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({ summary: 'Cuentas bancarias de la empresa' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "getCuentas", null);
__decorate([
    (0, common_1.Post)('cuentas'),
    (0, roles_decorator_1.Roles)('Administrador', 'Supervisor'),
    (0, swagger_1.ApiOperation)({ summary: 'Registrar cuenta bancaria de la empresa' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [pago_dto_1.CreateCuentaBancariaDto, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "createCuenta", null);
__decorate([
    (0, common_1.Post)('mercadopago/preferencia'),
    (0, roles_decorator_1.RequirePermission)('pagos:create'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Crear preferencia de pago MercadoPago',
        description: 'Genera una URL de pago a la que redirigir al cliente para pagar con MP.',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [pago_dto_1.CrearPreferenciaDto, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "crearPreferenciaMp", null);
__decorate([
    (0, common_1.Post)('webhooks/mercadopago'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiOperation)({
        summary: 'Webhook de MercadoPago (endpoint público)',
        description: 'Recibe notificaciones de MercadoPago. Verificado con HMAC-SHA256. ' +
            'No llamar manualmente.',
    }),
    (0, swagger_1.ApiHeader)({ name: 'x-signature', description: 'Firma HMAC-SHA256 de MP', required: true }),
    (0, swagger_1.ApiHeader)({ name: 'x-request-id', description: 'Request ID único de MP', required: true }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Headers)('x-signature')),
    __param(3, (0, common_1.Headers)('x-request-id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "webhookMercadoPago", null);
__decorate([
    (0, common_1.Get)('factura/:facturaId'),
    (0, roles_decorator_1.RequirePermission)('pagos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'facturaId' }),
    __param(0, (0, common_1.Param)('facturaId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "findByFactura", null);
__decorate([
    (0, common_1.Get)('contrato/:contratoId'),
    (0, roles_decorator_1.RequirePermission)('pagos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'contratoId' }),
    __param(0, (0, common_1.Param)('contratoId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "findByContrato", null);
__decorate([
    (0, common_1.Get)('cliente/:clienteId'),
    (0, roles_decorator_1.RequirePermission)('pagos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'clienteId' }),
    __param(0, (0, common_1.Param)('clienteId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "findByCliente", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.RequirePermission)('pagos:view'),
    (0, common_1.SetMetadata)('skipAudit', true),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/verificar'),
    (0, roles_decorator_1.RequirePermission)('pagos:verify'),
    (0, swagger_1.ApiOperation)({
        summary: 'Verificar (aprobar o rechazar) un pago pendiente',
        description: 'Al aprobar: aplica el pago a la factura y, si el contrato tenía mora ' +
            'y la deuda queda en cero, lo reactiva automáticamente sin intervención adicional.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Pago ya verificado o rechazado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, pago_dto_1.VerificarPagoDto, Object, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "verificar", null);
__decorate([
    (0, common_1.Patch)(':id/conciliar'),
    (0, roles_decorator_1.RequirePermission)('pagos:conciliar'),
    (0, swagger_1.ApiOperation)({
        summary: 'Conciliar pago con extracto bancario',
        description: 'Marca el pago como conciliado con la referencia del extracto del banco.',
    }),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, pago_dto_1.ConciliarPagoDto, Object, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "conciliar", null);
__decorate([
    (0, common_1.Post)(':id/comprobante'),
    (0, roles_decorator_1.RequirePermission)('pagos:create'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('comprobante', {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_, f, cb) => {
            const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.mimetype);
            cb(ok ? null : new Error('Solo imágenes JPG/PNG/WebP o PDF'), ok);
        },
    })),
    (0, swagger_1.ApiOperation)({ summary: 'Subir foto del comprobante/voucher de pago' }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiParam)({ name: 'id' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PagosController.prototype, "subirComprobante", null);
exports.PagosController = PagosController = PagosController_1 = __decorate([
    (0, swagger_1.ApiTags)('Pagos'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('pagos'),
    __metadata("design:paramtypes", [pagos_service_1.PagosService])
], PagosController);
//# sourceMappingURL=pagos.controller.js.map