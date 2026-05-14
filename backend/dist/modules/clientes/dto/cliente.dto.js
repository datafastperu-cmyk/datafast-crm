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
exports.ExportClientesDto = exports.ReniecResponseDto = exports.ConsultarReniecDto = exports.CambiarEstadoDto = exports.FilterClienteDto = exports.UpdateClienteDto = exports.CreateClienteDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const response_dto_1 = require("../../../common/dto/response.dto");
const cliente_entity_1 = require("../entities/cliente.entity");
class CreateClienteDto {
    constructor() {
        this.tipoDocumento = cliente_entity_1.TipoDocumento.DNI;
    }
}
exports.CreateClienteDto = CreateClienteDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: cliente_entity_1.TipoDocumento, default: cliente_entity_1.TipoDocumento.DNI }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(cliente_entity_1.TipoDocumento),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "tipoDocumento", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '12345678' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Length)(7, 20),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "numeroDocumento", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Juan Carlos' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "nombres", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Pérez' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(80),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "apellidoPaterno", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'García' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "apellidoMaterno", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)({}, { message: 'Email inválido' }),
    (0, class_validator_1.MaxLength)(150),
    (0, class_transformer_1.Transform)(({ value }) => value?.toLowerCase().trim()),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '987654321' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Matches)(/^[\d\s\+\-\(\)]{7,20}$/, { message: 'Teléfono inválido' }),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "telefono", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "telefonoAlt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "whatsapp", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Av. Sánchez Cerro 1234' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "direccion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "referencia", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "departamento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "provincia", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "distrito", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(10),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "ubigeo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: -5.1945 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-90),
    (0, class_validator_1.Max)(90),
    __metadata("design:type", Number)
], CreateClienteDto.prototype, "latitud", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: -80.6328 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-180),
    (0, class_validator_1.Max)(180),
    __metadata("design:type", Number)
], CreateClienteDto.prototype, "longitud", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: cliente_entity_1.TipoServicio, default: cliente_entity_1.TipoServicio.FTTH }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(cliente_entity_1.TipoServicio),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "tipoServicio", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(30),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "codigoCliente", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "notasInternas", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateClienteDto.prototype, "etiquetas", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateClienteDto.prototype, "esEmpresa", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.ValidateIf)((o) => o.esEmpresa === true),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(11, 11, { message: 'El RUC debe tener 11 dígitos' }),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "rucEmpresa", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.ValidateIf)((o) => o.esEmpresa === true),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "razonSocial", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateClienteDto.prototype, "fotoUrl", void 0);
class UpdateClienteDto extends (0, swagger_1.PartialType)(CreateClienteDto) {
}
exports.UpdateClienteDto = UpdateClienteDto;
class FilterClienteDto extends response_dto_1.PaginationDto {
}
exports.FilterClienteDto = FilterClienteDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: cliente_entity_1.EstadoCliente }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(cliente_entity_1.EstadoCliente),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: cliente_entity_1.EstadoCliente, isArray: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsEnum)(cliente_entity_1.EstadoCliente, { each: true }),
    (0, class_transformer_1.Transform)(({ value }) => Array.isArray(value) ? value : [value]),
    __metadata("design:type", Array)
], FilterClienteDto.prototype, "estados", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: cliente_entity_1.TipoServicio }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(cliente_entity_1.TipoServicio),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "tipoServicio", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: cliente_entity_1.TipoDocumento }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(cliente_entity_1.TipoDocumento),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "tipoDocumento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "documento", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "telefono", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "distrito", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "vendedorId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FilterClienteDto.prototype, "conUbicacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FilterClienteDto.prototype, "esEmpresa", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "etiqueta", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "fechaDesde", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterClienteDto.prototype, "fechaHasta", void 0);
class CambiarEstadoDto {
}
exports.CambiarEstadoDto = CambiarEstadoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: cliente_entity_1.EstadoCliente }),
    (0, class_validator_1.IsEnum)(cliente_entity_1.EstadoCliente),
    __metadata("design:type", String)
], CambiarEstadoDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CambiarEstadoDto.prototype, "motivo", void 0);
class ConsultarReniecDto {
}
exports.ConsultarReniecDto = ConsultarReniecDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '12345678' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\d{8}$/, { message: 'El DNI debe ser exactamente 8 dígitos numéricos' }),
    __metadata("design:type", String)
], ConsultarReniecDto.prototype, "dni", void 0);
class ReniecResponseDto {
}
exports.ReniecResponseDto = ReniecResponseDto;
class ExportClientesDto extends (0, swagger_1.OmitType)(FilterClienteDto, ['page', 'limit', 'sortBy', 'sortOrder']) {
    constructor() {
        super(...arguments);
        this.formato = 'csv';
    }
}
exports.ExportClientesDto = ExportClientesDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ['csv', 'xlsx'], default: 'csv' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ExportClientesDto.prototype, "formato", void 0);
//# sourceMappingURL=cliente.dto.js.map