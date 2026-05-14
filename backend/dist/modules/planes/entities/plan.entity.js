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
exports.Plan = exports.AccionAlLimite = exports.TipoQueue = exports.TipoPlan = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
var TipoPlan;
(function (TipoPlan) {
    TipoPlan["RESIDENCIAL"] = "residencial";
    TipoPlan["EMPRESARIAL"] = "empresarial";
    TipoPlan["DEDICADO"] = "dedicado";
    TipoPlan["PREPAGO"] = "prepago";
})(TipoPlan || (exports.TipoPlan = TipoPlan = {}));
var TipoQueue;
(function (TipoQueue) {
    TipoQueue["SIMPLE_QUEUE"] = "simple_queue";
    TipoQueue["QUEUE_TREE"] = "queue_tree";
    TipoQueue["PCQ"] = "pcq";
    TipoQueue["SIN_LIMITE"] = "sin_limite";
})(TipoQueue || (exports.TipoQueue = TipoQueue = {}));
var AccionAlLimite;
(function (AccionAlLimite) {
    AccionAlLimite["REDUCIR_VELOCIDAD"] = "reducir_velocidad";
    AccionAlLimite["BLOQUEAR"] = "bloquear";
    AccionAlLimite["NOTIFICAR"] = "notificar";
    AccionAlLimite["SIN_ACCION"] = "sin_accion";
})(AccionAlLimite || (exports.AccionAlLimite = AccionAlLimite = {}));
let Plan = class Plan extends base_entity_1.BaseModel {
    get maxLimitMikrotik() { return `${this.velocidadSubida}M/${this.velocidadBajada}M`; }
    get descripcionVelocidad() { return `${this.velocidadBajada}/${this.velocidadSubida} Mbps`; }
};
exports.Plan = Plan;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Plan.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Plan.prototype, "nombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Plan.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: TipoPlan, default: TipoPlan.RESIDENCIAL }),
    __metadata("design:type", String)
], Plan.prototype, "tipo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'color_ui', length: 20, default: '#3B82F6' }),
    __metadata("design:type", String)
], Plan.prototype, "colorUi", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'velocidad_bajada', type: 'int' }),
    __metadata("design:type", Number)
], Plan.prototype, "velocidadBajada", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'velocidad_subida', type: 'int' }),
    __metadata("design:type", Number)
], Plan.prototype, "velocidadSubida", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'burst_bajada', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Plan.prototype, "burstBajada", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'burst_subida', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Plan.prototype, "burstSubida", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'burst_tiempo', type: 'smallint', default: 0 }),
    __metadata("design:type", Number)
], Plan.prototype, "burstTiempo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'velocidad_garantizada', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Plan.prototype, "velocidadGarantizada", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 2 }),
    __metadata("design:type", Number)
], Plan.prototype, "precio", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'precio_instalacion', type: 'decimal', precision: 10, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Plan.prototype, "precioInstalacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'aplica_igv', default: true }),
    __metadata("design:type", Boolean)
], Plan.prototype, "aplicaIgv", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tipo_queue', type: 'enum', enum: TipoQueue, default: TipoQueue.SIMPLE_QUEUE }),
    __metadata("design:type", String)
], Plan.prototype, "tipoQueue", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ppp_profile', length: 100, nullable: true }),
    __metadata("design:type", String)
], Plan.prototype, "pppProfile", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ppp_service', length: 50, default: 'pppoe' }),
    __metadata("design:type", String)
], Plan.prototype, "pppService", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pool_ip', length: 100, nullable: true }),
    __metadata("design:type", String)
], Plan.prototype, "poolIp", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'vlan_id', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Plan.prototype, "vlanId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tipo_servicio', length: 20, default: 'ftth' }),
    __metadata("design:type", String)
], Plan.prototype, "tipoServicio", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ciclo_facturacion', length: 20, default: 'mensual' }),
    __metadata("design:type", String)
], Plan.prototype, "cicloFacturacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'dias_contrato_minimo', type: 'int', default: 0 }),
    __metadata("design:type", Number)
], Plan.prototype, "diasContratoMinimo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tiene_limite_datos', default: false }),
    __metadata("design:type", Boolean)
], Plan.prototype, "tieneLimiteDatos", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'limite_datos_gb', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Plan.prototype, "limiteDatosGb", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'accion_al_limite', type: 'enum', enum: AccionAlLimite, default: AccionAlLimite.REDUCIR_VELOCIDAD }),
    __metadata("design:type", String)
], Plan.prototype, "accionAlLimite", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'velocidad_post_limite', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Plan.prototype, "velocidadPostLimite", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], Plan.prototype, "activo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'visible_en_portal', default: false }),
    __metadata("design:type", Boolean)
], Plan.prototype, "visibleEnPortal", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'orden_display', type: 'smallint', default: 0 }),
    __metadata("design:type", Number)
], Plan.prototype, "ordenDisplay", void 0);
exports.Plan = Plan = __decorate([
    (0, typeorm_1.Entity)('planes'),
    (0, typeorm_1.Index)(['empresaId', 'activo']),
    (0, typeorm_1.Index)(['empresaId', 'tipoServicio'])
], Plan);
//# sourceMappingURL=plan.entity.js.map