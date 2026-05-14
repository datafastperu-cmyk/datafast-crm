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
exports.FlujoComipletoResultadoDto = exports.ActualizarSeñalDto = exports.FilterOnuDto = exports.AsociarOnuContratoDto = exports.FlujoComipletoFtthDto = exports.ProvisionarOnuDto = exports.UpdateOltDto = exports.CreateOltDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const onu_entity_1 = require("../entities/onu.entity");
const response_dto_1 = require("../../../common/dto/response.dto");
class CreateOltDto {
}
exports.CreateOltDto = CreateOltDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'OLT Centro Piura' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateOltDto.prototype, "nombre", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateOltDto.prototype, "descripcion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'Huawei' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateOltDto.prototype, "marca", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'MA5800-X7' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateOltDto.prototype, "modelo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'ID del dispositivo en SmartOLT' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateOltDto.prototype, "smartoltId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '10.0.0.1' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], CreateOltDto.prototype, "ipGestion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateOltDto.prototype, "usuario", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateOltDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateOltDto.prototype, "ubicacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(64),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateOltDto.prototype, "totalPonPorts", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateOltDto.prototype, "activo", void 0);
class UpdateOltDto extends (0, swagger_1.PartialType)(CreateOltDto) {
}
exports.UpdateOltDto = UpdateOltDto;
class ProvisionarOnuDto {
}
exports.ProvisionarOnuDto = ProvisionarOnuDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'ID del OLT en el sistema' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "oltId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '48575443ABCD1234', description: 'Serial Number de la ONU' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(50),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim().toUpperCase()),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "serialNumber", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '0/1/3', description: 'Puerto PON en formato slot/subslot/port' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "ponPort", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'HSI-BRIDGE-100M', description: 'Perfil de servicio en SmartOLT' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "perfil", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 100, description: 'VLAN ID del servicio (1-4094)' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(4094),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ProvisionarOnuDto.prototype, "vlanId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'access' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "vlanModo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Descripción visible en SmartOLT' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "descripcion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'ID del contrato a asociar' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Modelo físico de la ONU (ej: HG8310M)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], ProvisionarOnuDto.prototype, "modelo", void 0);
class FlujoComipletoFtthDto {
}
exports.FlujoComipletoFtthDto = FlujoComipletoFtthDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del contrato en el sistema' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del cliente' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del OLT donde está conectada la ONU' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "oltId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'SN de la ONU (si ya se conoce). Si omitido: detectar automáticamente' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(50),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim().toUpperCase()),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "serialNumber", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '0/1/3' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "ponPort", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Perfil de SmartOLT para el plan del cliente' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "perfil", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 100 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(4094),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], FlujoComipletoFtthDto.prototype, "vlanId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del router Mikrotik al que conectar' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "routerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del segmento IPv4 para asignar IP' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FlujoComipletoFtthDto.prototype, "segmentoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Notificar al cliente por WhatsApp al activar' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FlujoComipletoFtthDto.prototype, "notificarCliente", void 0);
class AsociarOnuContratoDto {
}
exports.AsociarOnuContratoDto = AsociarOnuContratoDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AsociarOnuContratoDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AsociarOnuContratoDto.prototype, "onuId", void 0);
class FilterOnuDto extends response_dto_1.PaginationDto {
}
exports.FilterOnuDto = FilterOnuDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: onu_entity_1.EstadoOnu }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(onu_entity_1.EstadoOnu),
    __metadata("design:type", String)
], FilterOnuDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], FilterOnuDto.prototype, "oltId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim()),
    __metadata("design:type", String)
], FilterOnuDto.prototype, "serialNumber", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FilterOnuDto.prototype, "ponPort", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Solo ONUs sin contrato asignado' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FilterOnuDto.prototype, "sinContrato", void 0);
class ActualizarSeñalDto {
}
exports.ActualizarSeñalDto = ActualizarSeñalDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ActualizarSeñalDto.prototype, "rxPowerDbm", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ActualizarSeñalDto.prototype, "txPowerDbm", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ActualizarSeñalDto.prototype, "temperaturaC", void 0);
class FlujoComipletoResultadoDto {
}
exports.FlujoComipletoResultadoDto = FlujoComipletoResultadoDto;
//# sourceMappingURL=smartolt.dto.js.map