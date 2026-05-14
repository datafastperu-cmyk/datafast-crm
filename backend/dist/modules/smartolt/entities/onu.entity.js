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
exports.Onu = exports.Olt = exports.EstadoOnu = exports.EstadoOlt = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
var EstadoOlt;
(function (EstadoOlt) {
    EstadoOlt["ONLINE"] = "online";
    EstadoOlt["OFFLINE"] = "offline";
    EstadoOlt["MANTENIMIENTO"] = "mantenimiento";
    EstadoOlt["DESCONOCIDO"] = "desconocido";
})(EstadoOlt || (exports.EstadoOlt = EstadoOlt = {}));
var EstadoOnu;
(function (EstadoOnu) {
    EstadoOnu["SIN_APROVISIONAR"] = "sin_aprovisionar";
    EstadoOnu["APROVISIONADA"] = "aprovisionada";
    EstadoOnu["ONLINE"] = "online";
    EstadoOnu["OFFLINE"] = "offline";
    EstadoOnu["ERROR"] = "error";
    EstadoOnu["REEMPLAZADA"] = "reemplazada";
})(EstadoOnu || (exports.EstadoOnu = EstadoOnu = {}));
let Olt = class Olt extends base_entity_1.BaseModel {
};
exports.Olt = Olt;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Olt.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Olt.prototype, "nombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Olt.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 50, default: 'Huawei' }),
    __metadata("design:type", String)
], Olt.prototype, "marca", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Olt.prototype, "modelo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'smartolt_id', length: 100, nullable: true }),
    __metadata("design:type", String)
], Olt.prototype, "smartoltId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ip_gestion', type: 'inet', nullable: true }),
    __metadata("design:type", String)
], Olt.prototype, "ipGestion", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Olt.prototype, "usuario", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'password_cifrado', length: 500, nullable: true }),
    __metadata("design:type", String)
], Olt.prototype, "passwordCifrado", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: EstadoOlt, default: EstadoOlt.DESCONOCIDO }),
    __metadata("design:type", String)
], Olt.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ultimo_ping', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Olt.prototype, "ultimoPing", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_pon_ports', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Olt.prototype, "totalPonPorts", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'onus_activas', type: 'int', default: 0 }),
    __metadata("design:type", Number)
], Olt.prototype, "onusActivas", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 200, nullable: true }),
    __metadata("design:type", String)
], Olt.prototype, "ubicacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Olt.prototype, "latitud", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Olt.prototype, "longitud", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], Olt.prototype, "activo", void 0);
exports.Olt = Olt = __decorate([
    (0, typeorm_1.Entity)('olts'),
    (0, typeorm_1.Index)(['empresaId', 'activo'])
], Olt);
let Onu = class Onu extends base_entity_1.BaseModel {
};
exports.Onu = Onu;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Onu.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'olt_id' }),
    __metadata("design:type", String)
], Onu.prototype, "oltId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'serial_number', length: 50 }),
    __metadata("design:type", String)
], Onu.prototype, "serialNumber", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'mac_address', type: 'macaddr', nullable: true }),
    __metadata("design:type", String)
], Onu.prototype, "macAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Onu.prototype, "modelo", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 50, default: 'Huawei' }),
    __metadata("design:type", String)
], Onu.prototype, "marca", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pon_port', length: 30, nullable: true }),
    __metadata("design:type", String)
], Onu.prototype, "ponPort", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pon_slot', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "ponSlot", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pon_subslot', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "ponSubslot", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pon_port_num', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "ponPortNum", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'onu_id', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "onuId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'perfil_smartolt', length: 100, nullable: true }),
    __metadata("design:type", String)
], Onu.prototype, "perfilSmartolt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'smartolt_onu_id', length: 100, nullable: true }),
    __metadata("design:type", String)
], Onu.prototype, "smartoltOnuId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'vlan_id', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "vlanId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'vlan_modo', length: 20, default: 'access' }),
    __metadata("design:type", String)
], Onu.prototype, "vlanModo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: EstadoOnu, default: EstadoOnu.SIN_APROVISIONAR }),
    __metadata("design:type", String)
], Onu.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'rx_power_dbm', type: 'decimal', precision: 6, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "rxPowerDbm", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tx_power_dbm', type: 'decimal', precision: 6, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "txPowerDbm", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "temperaturaC", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'voltaje_v', type: 'decimal', precision: 6, scale: 3, nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "voltajeV", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'distancia_km', type: 'decimal', precision: 8, scale: 3, nullable: true }),
    __metadata("design:type", Number)
], Onu.prototype, "distanciaKm", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'aprovisionada_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Onu.prototype, "aprovisionadaEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'aprovisionada_por', nullable: true }),
    __metadata("design:type", String)
], Onu.prototype, "aprovisionadaPor", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ultimo_online', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Onu.prototype, "ultimoOnline", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Onu.prototype, "descripcion", void 0);
exports.Onu = Onu = __decorate([
    (0, typeorm_1.Entity)('onus'),
    (0, typeorm_1.Index)(['empresaId', 'estado']),
    (0, typeorm_1.Index)(['oltId', 'ponPort', 'onuId'], { unique: true, where: 'deleted_at IS NULL' }),
    (0, typeorm_1.Index)(['serialNumber'])
], Onu);
//# sourceMappingURL=onu.entity.js.map