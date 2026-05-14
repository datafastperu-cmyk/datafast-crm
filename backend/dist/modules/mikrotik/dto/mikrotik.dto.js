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
exports.PingDto = exports.ActualizarQueueDto = exports.DhcpBindingDto = exports.ReactivarClienteDto = exports.SuspenderClienteDto = exports.ProvisionarClienteDto = exports.UpdateRouterDto = exports.CreateRouterDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const router_entity_1 = require("../entities/router.entity");
class CreateRouterDto {
}
exports.CreateRouterDto = CreateRouterDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Router Castilla Norte' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "nombre", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "descripcion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Av. Sánchez Cerro 1234' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "ubicacion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'CCR1036-12G-4S' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "modelo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '192.168.100.1' }),
    (0, class_validator_1.IsIP)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "ipGestion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 8728 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(65535),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRouterDto.prototype, "puertoApi", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 8729 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(65535),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRouterDto.prototype, "puertoApiSsl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 22 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(65535),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRouterDto.prototype, "puertoSsh", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'admin' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "usuario", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'MiPassword123' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: router_entity_1.MetodoConexion, default: router_entity_1.MetodoConexion.API }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(router_entity_1.MetodoConexion),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "metodoConexion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateRouterDto.prototype, "usarSsl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 10 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(3),
    (0, class_validator_1.Max)(60),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRouterDto.prototype, "timeoutConexion", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: -5.1945 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-90),
    (0, class_validator_1.Max)(90),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRouterDto.prototype, "latitud", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: -80.6328 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-180),
    (0, class_validator_1.Max)(180),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRouterDto.prototype, "longitud", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'public' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateRouterDto.prototype, "snmpCommunity", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateRouterDto.prototype, "autoConfigurarQueues", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateRouterDto.prototype, "autoConfigurarPppoe", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateRouterDto.prototype, "autoConfigurarFirewall", void 0);
class UpdateRouterDto extends (0, swagger_1.PartialType)(CreateRouterDto) {
}
exports.UpdateRouterDto = UpdateRouterDto;
class ProvisionarClienteDto {
}
exports.ProvisionarClienteDto = ProvisionarClienteDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del cliente en el sistema' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ProvisionarClienteDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'cli_abc12345' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], ProvisionarClienteDto.prototype, "usuarioPppoe", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'P@ssw0rd123' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], ProvisionarClienteDto.prototype, "passwordPppoe", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '192.168.1.2' }),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], ProvisionarClienteDto.prototype, "ipAsignada", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'plan-30mbps' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], ProvisionarClienteDto.prototype, "perfilPppoe", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 30, description: 'Bajada Mbps' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(10000),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ProvisionarClienteDto.prototype, "downloadMbps", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 15, description: 'Subida Mbps' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(10000),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ProvisionarClienteDto.prototype, "uploadMbps", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Burst bajada Mbps' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ProvisionarClienteDto.prototype, "burstDownMbps", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Burst subida Mbps' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ProvisionarClienteDto.prototype, "burstUpMbps", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 8 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ProvisionarClienteDto.prototype, "burstTiempoSegundos", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: ['simple_queue', 'queue_tree', 'pcq', 'sin_limite'],
        default: 'simple_queue',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ProvisionarClienteDto.prototype, "tipoQueue", void 0);
class SuspenderClienteDto {
}
exports.SuspenderClienteDto = SuspenderClienteDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], SuspenderClienteDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '192.168.1.2' }),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], SuspenderClienteDto.prototype, "ipAsignada", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'cli_abc12345' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], SuspenderClienteDto.prototype, "usuarioPppoe", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'mora' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], SuspenderClienteDto.prototype, "motivo", void 0);
class ReactivarClienteDto {
}
exports.ReactivarClienteDto = ReactivarClienteDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ReactivarClienteDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '192.168.1.2' }),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], ReactivarClienteDto.prototype, "ipAsignada", void 0);
class DhcpBindingDto {
}
exports.DhcpBindingDto = DhcpBindingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'AA:BB:CC:DD:EE:FF' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(17),
    __metadata("design:type", String)
], DhcpBindingDto.prototype, "macAddress", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '192.168.1.10' }),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], DhcpBindingDto.prototype, "ipAddress", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], DhcpBindingDto.prototype, "hostname", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], DhcpBindingDto.prototype, "comment", void 0);
class ActualizarQueueDto {
}
exports.ActualizarQueueDto = ActualizarQueueDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'cli_abc12345' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ActualizarQueueDto.prototype, "nombreQueue", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 30 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ActualizarQueueDto.prototype, "downloadMbps", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 15 }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ActualizarQueueDto.prototype, "uploadMbps", void 0);
class PingDto {
}
exports.PingDto = PingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '8.8.8.8' }),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], PingDto.prototype, "destino", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 4 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(20),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], PingDto.prototype, "count", void 0);
//# sourceMappingURL=mikrotik.dto.js.map