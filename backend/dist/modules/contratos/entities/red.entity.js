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
exports.IpAsignada = exports.SegmentoIpv4 = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
let SegmentoIpv4 = class SegmentoIpv4 extends base_entity_1.BaseModel {
    get porcentajeUso() {
        if (!this.totalIps)
            return 0;
        return Math.round((this.ipsUsadas / this.totalIps) * 100);
    }
};
exports.SegmentoIpv4 = SegmentoIpv4;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'router_id', nullable: true }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "routerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nodo_id', nullable: true }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "nodoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "nombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'red_cidr', type: 'cidr' }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "redCidr", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'inet' }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "gateway", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'dns_primario', type: 'inet', default: '8.8.8.8' }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "dnsPrimario", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'dns_secundario', type: 'inet', nullable: true }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "dnsSecundario", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ips_reservadas', type: 'inet', array: true, nullable: true }),
    __metadata("design:type", Array)
], SegmentoIpv4.prototype, "ipsReservadas", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'total_ips', type: 'int', default: 0 }),
    __metadata("design:type", Number)
], SegmentoIpv4.prototype, "totalIps", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ips_usadas', type: 'int', default: 0 }),
    __metadata("design:type", Number)
], SegmentoIpv4.prototype, "ipsUsadas", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ips_disponibles', type: 'int', insert: false, update: false, nullable: true }),
    __metadata("design:type", Number)
], SegmentoIpv4.prototype, "ipsDisponibles", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tipo_servicio', length: 20, default: 'ftth' }),
    __metadata("design:type", String)
], SegmentoIpv4.prototype, "tipoServicio", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'vlan_id', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], SegmentoIpv4.prototype, "vlanId", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], SegmentoIpv4.prototype, "activo", void 0);
exports.SegmentoIpv4 = SegmentoIpv4 = __decorate([
    (0, typeorm_1.Entity)('segmentos_ipv4'),
    (0, typeorm_1.Index)(['empresaId', 'activo'])
], SegmentoIpv4);
let IpAsignada = class IpAsignada {
};
exports.IpAsignada = IpAsignada;
__decorate([
    (0, typeorm_1.Column)({ primary: true, generated: 'uuid' }),
    __metadata("design:type", String)
], IpAsignada.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], IpAsignada.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'segmento_id' }),
    __metadata("design:type", String)
], IpAsignada.prototype, "segmentoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'contrato_id', nullable: true }),
    __metadata("design:type", String)
], IpAsignada.prototype, "contratoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ip_address', type: 'inet' }),
    __metadata("design:type", String)
], IpAsignada.prototype, "ipAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 200, nullable: true }),
    __metadata("design:type", String)
], IpAsignada.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 30, default: 'cliente' }),
    __metadata("design:type", String)
], IpAsignada.prototype, "tipo", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], IpAsignada.prototype, "activa", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'asignada_en', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], IpAsignada.prototype, "asignadaEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'liberada_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], IpAsignada.prototype, "liberadaEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], IpAsignada.prototype, "createdAt", void 0);
exports.IpAsignada = IpAsignada = __decorate([
    (0, typeorm_1.Entity)('ips_asignadas'),
    (0, typeorm_1.Index)(['segmentoId', 'activa']),
    (0, typeorm_1.Index)(['ipAddress'])
], IpAsignada);
//# sourceMappingURL=red.entity.js.map