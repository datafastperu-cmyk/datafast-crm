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
exports.AprovisionamientoResultadoDto = exports.PasoResultadoDto = exports.RollbackAprovisionamientoDto = exports.AprovisionarFtthDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
class AprovisionarFtthDto {
    constructor() {
        this.vlanModo = 'access';
        this.notificarWhatsApp = true;
        this.notificarEmail = false;
        this.omitirQueue = false;
        this.rollbackEnError = true;
    }
}
exports.AprovisionarFtthDto = AprovisionarFtthDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del contrato existente en estado PENDIENTE_INSTALACION' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del cliente (validación cruzada)' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "clienteId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del OLT (registro local) donde está la ONU' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "oltId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Serial Number de la ONU. Si se omite, se detecta automáticamente ' +
            'buscando la primera ONU no aprovisionada en el ponPort indicado.',
        example: '48575443ABCD1234',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(50),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim().toUpperCase()),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "serialNumber", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '0/1/3',
        description: 'Puerto PON en formato slot/subslot/port (Huawei MA5800)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "ponPort", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'HSI-BRIDGE-100M',
        description: 'Nombre exacto del perfil de servicio en SmartOLT',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "perfilSmartolt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 100, description: 'VLAN del servicio (1–4094)' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(4094),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AprovisionarFtthDto.prototype, "vlanId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ['access', 'trunk'], default: 'access' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "vlanModo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del router Mikrotik donde crear PPPoE + Queue' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "routerId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'UUID del segmento IPv4 del que tomar la próxima IP disponible. ' +
            'Si el contrato ya tiene ip_asignada, este campo se ignora.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "segmentoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'IP específica a asignar (sobreescribe el pool automático)',
        example: '192.168.1.50',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIP)(),
    __metadata("design:type", String)
], AprovisionarFtthDto.prototype, "ipManual", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Enviar WhatsApp al cliente al activar el servicio',
        default: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AprovisionarFtthDto.prototype, "notificarWhatsApp", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Enviar email al cliente al activar el servicio',
        default: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AprovisionarFtthDto.prototype, "notificarEmail", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Omitir el paso de configuración de velocidad en Mikrotik (para debug)',
        default: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AprovisionarFtthDto.prototype, "omitirQueue", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'En caso de error en algún paso, hacer rollback de los pasos anteriores',
        default: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AprovisionarFtthDto.prototype, "rollbackEnError", void 0);
class RollbackAprovisionamientoDto {
    constructor() {
        this.eliminarSmartolt = true;
        this.eliminarPppoe = true;
        this.liberarIp = true;
    }
}
exports.RollbackAprovisionamientoDto = RollbackAprovisionamientoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'UUID del contrato a revertir' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RollbackAprovisionamientoDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Motivo del rollback' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], RollbackAprovisionamientoDto.prototype, "motivo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Eliminar provisión de SmartOLT', default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RollbackAprovisionamientoDto.prototype, "eliminarSmartolt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Eliminar usuario PPPoE del Mikrotik', default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RollbackAprovisionamientoDto.prototype, "eliminarPppoe", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Liberar IP del pool', default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RollbackAprovisionamientoDto.prototype, "liberarIp", void 0);
class PasoResultadoDto {
}
exports.PasoResultadoDto = PasoResultadoDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PasoResultadoDto.prototype, "paso", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PasoResultadoDto.prototype, "nombre", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ok', 'error', 'omitido', 'revertido'] }),
    __metadata("design:type", String)
], PasoResultadoDto.prototype, "estado", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PasoResultadoDto.prototype, "detalle", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], PasoResultadoDto.prototype, "duracionMs", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Object)
], PasoResultadoDto.prototype, "datos", void 0);
class AprovisionamientoResultadoDto {
}
exports.AprovisionamientoResultadoDto = AprovisionamientoResultadoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PasoResultadoDto] }),
    __metadata("design:type", Array)
], AprovisionamientoResultadoDto.prototype, "pasos", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], AprovisionamientoResultadoDto.prototype, "exitoso", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], AprovisionamientoResultadoDto.prototype, "contratoId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], AprovisionamientoResultadoDto.prototype, "ipAsignada", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], AprovisionamientoResultadoDto.prototype, "usuarioPppoe", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], AprovisionamientoResultadoDto.prototype, "onuId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], AprovisionamientoResultadoDto.prototype, "serialNumber", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], AprovisionamientoResultadoDto.prototype, "duracionTotalMs", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], AprovisionamientoResultadoDto.prototype, "mensajeFinal", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Boolean)
], AprovisionamientoResultadoDto.prototype, "rollbackEjecutado", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Array)
], AprovisionamientoResultadoDto.prototype, "pasosFallidos", void 0);
//# sourceMappingURL=aprovisionamiento.dto.js.map