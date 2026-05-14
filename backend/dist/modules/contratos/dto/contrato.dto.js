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
exports.ContratoCompletoDto = exports.FilterContratoDto = exports.OtorgarProrrogaDto = exports.CambiarEstadoContratoDto = exports.UpdateContratoDto = exports.CreateContratoDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const contrato_entity_1 = require("../entities/contrato.entity");
const response_dto_1 = require("../../../common/dto/response.dto");
class CreateContratoDto {
}
exports.CreateContratoDto = CreateContratoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del cliente' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del plan de servicio' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "planId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'UUID del router Mikrotik' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "routerId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'UUID del nodo/antena' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "nodoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'UUID del segmento IPv4 para asignar IP automáticamente' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "segmentoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'IP específica (sobreescribe asignación automática del pool)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "ipManual", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'UUID del técnico responsable de la instalación' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "tecnicoInstalacionId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'UUID del vendedor que captó al cliente' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "vendedorId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2024-01-15', description: 'Fecha de inicio del contrato' }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "fechaInicio", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '2025-01-15', description: 'Fecha de vencimiento (null = indefinido)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "fechaVencimiento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "direccionInstalacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-90),
    (0, class_validator_1.Max)(90),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateContratoDto.prototype, "latitudInstalacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-180),
    (0, class_validator_1.Max)(180),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateContratoDto.prototype, "longitudInstalacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Usuario PPPoE — se autogenera si se omite' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "usuarioPppoe", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Password PPPoE — se autogenera si se omite' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "passwordPppoePlain", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 100 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(4094),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateContratoDto.prototype, "vlanId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Precio mensual personalizado — si omitido usa el del plan' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateContratoDto.prototype, "precioMensual", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 10, description: '% de descuento 0-100' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateContratoDto.prototype, "descuentoPct", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "descuentoMotivo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Día 1-28 para facturar este contrato' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(28),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateContratoDto.prototype, "diaFacturacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "notasInstalacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "notasTecnicas", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CreateContratoDto.prototype, "notasAdmin", void 0);
class UpdateContratoDto extends (0, swagger_1.PartialType)(CreateContratoDto) {
}
exports.UpdateContratoDto = UpdateContratoDto;
class CambiarEstadoContratoDto {
}
exports.CambiarEstadoContratoDto = CambiarEstadoContratoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: contrato_entity_1.EstadoContrato }),
    (0, class_validator_1.IsEnum)(contrato_entity_1.EstadoContrato),
    __metadata("design:type", String)
], CambiarEstadoContratoDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CambiarEstadoContratoDto.prototype, "motivo", void 0);
class OtorgarProrrogaDto {
}
exports.OtorgarProrrogaDto = OtorgarProrrogaDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2024-02-28', description: 'Fecha límite de la prórroga' }),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], OtorgarProrrogaDto.prototype, "prorrogaHasta", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], OtorgarProrrogaDto.prototype, "motivo", void 0);
class FilterContratoDto extends response_dto_1.PaginationDto {
}
exports.FilterContratoDto = FilterContratoDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: contrato_entity_1.EstadoContrato }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(contrato_entity_1.EstadoContrato),
    __metadata("design:type", String)
], FilterContratoDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: contrato_entity_1.EstadoContrato, isArray: true }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], FilterContratoDto.prototype, "estados", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterContratoDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterContratoDto.prototype, "planId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterContratoDto.prototype, "routerId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterContratoDto.prototype, "tecnicoInstalacionId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo contratos en mora (deuda > 0)' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], FilterContratoDto.prototype, "conMora", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo contratos en prórroga' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], FilterContratoDto.prototype, "enProrroga", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo contratos aprovisionados' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], FilterContratoDto.prototype, "aprovisionado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], FilterContratoDto.prototype, "fechaDesde", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], FilterContratoDto.prototype, "fechaHasta", void 0);
class ContratoCompletoDto {
}
exports.ContratoCompletoDto = ContratoCompletoDto;
//# sourceMappingURL=contrato.dto.js.map