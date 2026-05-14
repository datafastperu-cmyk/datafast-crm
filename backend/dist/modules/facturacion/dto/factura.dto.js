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
exports.ResumenFinancieroDto = exports.FilterFacturaDto = exports.AnularFacturaDto = exports.CreateNotaCreditoDto = exports.GenerarFacturasMensualesDto = exports.CreateFacturaDto = exports.ItemFacturaDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const factura_entity_1 = require("../entities/factura.entity");
const response_dto_1 = require("../../../common/dto/response.dto");
class ItemFacturaDto {
}
exports.ItemFacturaDto = ItemFacturaDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], ItemFacturaDto.prototype, "descripcion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0.001),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ItemFacturaDto.prototype, "cantidad", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 85.00 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ItemFacturaDto.prototype, "precioUnitario", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ItemFacturaDto.prototype, "descuento", void 0);
class CreateFacturaDto {
}
exports.CreateFacturaDto = CreateFacturaDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: factura_entity_1.TipoComprobante, default: factura_entity_1.TipoComprobante.BOLETA }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(factura_entity_1.TipoComprobante),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "tipoComprobante", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2024-01-01' }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "periodoInicio", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2024-01-31' }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "periodoFin", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "descripcion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Items del comprobante. Si vacío, se toma el precio del contrato' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ItemFacturaDto),
    __metadata("design:type", Array)
], CreateFacturaDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Monto base sin IGV. Si se proveen items se calcula automáticamente' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateFacturaDto.prototype, "subtotal", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 0 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateFacturaDto.prototype, "descuento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Fecha de vencimiento. Por defecto: fechaEmision + días de gracia' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "fechaVencimiento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true, description: 'Si aplica IGV 18%' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateFacturaDto.prototype, "aplicaIgv", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'PEN' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "moneda", void 0);
class GenerarFacturasMensualesDto {
}
exports.GenerarFacturasMensualesDto = GenerarFacturasMensualesDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 2024 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], GenerarFacturasMensualesDto.prototype, "anio", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], GenerarFacturasMensualesDto.prototype, "mes", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo para un contrato específico (testing)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], GenerarFacturasMensualesDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: factura_entity_1.TipoComprobante.BOLETA }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(factura_entity_1.TipoComprobante),
    __metadata("design:type", String)
], GenerarFacturasMensualesDto.prototype, "tipoComprobante", void 0);
class CreateNotaCreditoDto {
}
exports.CreateNotaCreditoDto = CreateNotaCreditoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID de la factura original a anular/rectificar' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateNotaCreditoDto.prototype, "facturaOriginalId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Error en el monto facturado' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateNotaCreditoDto.prototype, "motivo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Monto a acreditar. Si omitido = total de la factura original' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0.01),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateNotaCreditoDto.prototype, "montoAcreditar", void 0);
class AnularFacturaDto {
}
exports.AnularFacturaDto = AnularFacturaDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], AnularFacturaDto.prototype, "motivo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Crear nota de crédito automáticamente', default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AnularFacturaDto.prototype, "crearNotaCredito", void 0);
class FilterFacturaDto extends response_dto_1.PaginationDto {
}
exports.FilterFacturaDto = FilterFacturaDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: factura_entity_1.EstadoFactura }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(factura_entity_1.EstadoFactura),
    __metadata("design:type", String)
], FilterFacturaDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: factura_entity_1.EstadoFactura, isArray: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => Array.isArray(value) ? value : [value]),
    __metadata("design:type", Array)
], FilterFacturaDto.prototype, "estados", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterFacturaDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterFacturaDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: factura_entity_1.TipoComprobante }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(factura_entity_1.TipoComprobante),
    __metadata("design:type", String)
], FilterFacturaDto.prototype, "tipoComprobante", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterFacturaDto.prototype, "serie", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterFacturaDto.prototype, "fechaDesde", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterFacturaDto.prototype, "fechaHasta", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo facturas vencidas' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    __metadata("design:type", Boolean)
], FilterFacturaDto.prototype, "vencidas", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo generadas automáticamente' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    __metadata("design:type", Boolean)
], FilterFacturaDto.prototype, "automatica", void 0);
class ResumenFinancieroDto {
}
exports.ResumenFinancieroDto = ResumenFinancieroDto;
//# sourceMappingURL=factura.dto.js.map