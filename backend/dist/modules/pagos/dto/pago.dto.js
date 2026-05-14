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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResumenCobranzaDto = exports.CreateCuentaBancariaDto = exports.CrearPreferenciaDto = exports.MercadoPagoWebhookDto = exports.FilterPagoDto = exports.ConciliarPagoDto = exports.VerificarPagoDto = exports.RegistrarPagoDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const pago_entity_1 = require("../entities/pago.entity");
const response_dto_1 = require("../../../common/dto/response.dto");
class RegistrarPagoDto {
}
exports.RegistrarPagoDto = RegistrarPagoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del cliente' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'UUID de la factura a pagar (puede aplicar a deuda general si omitido)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "facturaId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'UUID del contrato (requerido si no se especifica factura)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 85.00, description: 'Monto pagado' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsPositive)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], RegistrarPagoDto.prototype, "monto", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: pago_entity_1.MetodoPago }),
    (0, class_validator_1.IsEnum)(pago_entity_1.MetodoPago),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "metodoPago", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'BCP', description: 'Banco origen/destino' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "banco", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '12345678',
        description: 'Número de operación del banco/Yape/Plin — previene duplicados',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "numeroOperacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '6411', description: 'Últimos 4 dígitos de la cuenta destino' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "numeroCuenta", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '2024-01-20' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "fechaPago", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "notas", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'URL de la foto del voucher (subido previamente)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "comprobanteUrl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Si true, verificar automáticamente sin revisión manual', default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RegistrarPagoDto.prototype, "autoVerificar", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'PEN' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RegistrarPagoDto.prototype, "moneda", void 0);
class VerificarPagoDto {
}
exports.VerificarPagoDto = VerificarPagoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Resultado de la verificación', example: true }),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], VerificarPagoDto.prototype, "aprobado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Motivo del rechazo (requerido si aprobado=false)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], VerificarPagoDto.prototype, "motivoRechazo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Referencia en el extracto bancario' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], VerificarPagoDto.prototype, "extractoBancoRef", void 0);
class ConciliarPagoDto {
}
exports.ConciliarPagoDto = ConciliarPagoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Referencia en el extracto bancario' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], ConciliarPagoDto.prototype, "extractoBancoRef", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], ConciliarPagoDto.prototype, "notas", void 0);
class FilterPagoDto extends response_dto_1.PaginationDto {
}
exports.FilterPagoDto = FilterPagoDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: pago_entity_1.EstadoPago }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(pago_entity_1.EstadoPago),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: pago_entity_1.MetodoPago }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(pago_entity_1.MetodoPago),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "metodoPago", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "facturaId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "cajeroId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "banco", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "numeroOperacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "fechaDesde", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterPagoDto.prototype, "fechaHasta", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FilterPagoDto.prototype, "conciliado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo pagos de hoy' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FilterPagoDto.prototype, "soloHoy", void 0);
class MercadoPagoWebhookDto {
}
exports.MercadoPagoWebhookDto = MercadoPagoWebhookDto;
class CrearPreferenciaDto {
}
exports.CrearPreferenciaDto = CrearPreferenciaDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CrearPreferenciaDto.prototype, "facturaId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CrearPreferenciaDto.prototype, "urlExito", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CrearPreferenciaDto.prototype, "urlFallo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CrearPreferenciaDto.prototype, "urlPendiente", void 0);
class CreateCuentaBancariaDto {
}
exports.CreateCuentaBancariaDto = CreateCuentaBancariaDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateCuentaBancariaDto.prototype, "banco", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'corriente', enum: ['corriente', 'ahorros', 'recaudadora'] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateCuentaBancariaDto.prototype, "tipoCuenta", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateCuentaBancariaDto.prototype, "numeroCuenta", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateCuentaBancariaDto.prototype, "cci", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'PEN' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateCuentaBancariaDto.prototype, "moneda", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateCuentaBancariaDto.prototype, "titular", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateCuentaBancariaDto.prototype, "esPrincipal", void 0);
class ResumenCobranzaDto {
}
exports.ResumenCobranzaDto = ResumenCobranzaDto;
//# sourceMappingURL=pago.dto.js.map