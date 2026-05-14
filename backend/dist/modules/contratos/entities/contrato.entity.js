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
exports.ContratoHistorial = exports.Contrato = exports.EstadoContrato = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
var EstadoContrato;
(function (EstadoContrato) {
    EstadoContrato["PENDIENTE_INSTALACION"] = "pendiente_instalacion";
    EstadoContrato["ACTIVO"] = "activo";
    EstadoContrato["SUSPENDIDO_MORA"] = "suspendido_mora";
    EstadoContrato["SUSPENDIDO_MANUAL"] = "suspendido_manual";
    EstadoContrato["PRORROGA"] = "prorroga";
    EstadoContrato["BAJA_SOLICITADA"] = "baja_solicitada";
    EstadoContrato["BAJA_DEFINITIVA"] = "baja_definitiva";
    EstadoContrato["MIGRADO"] = "migrado";
})(EstadoContrato || (exports.EstadoContrato = EstadoContrato = {}));
let Contrato = class Contrato extends base_entity_1.BaseModel {
    get estaActivo() {
        return [EstadoContrato.ACTIVO, EstadoContrato.PRORROGA].includes(this.estado);
    }
    get estaSuspendido() {
        return [EstadoContrato.SUSPENDIDO_MORA, EstadoContrato.SUSPENDIDO_MANUAL].includes(this.estado);
    }
    get tieneMora() {
        return this.deudaTotal > 0;
    }
    get precioConDescuento() {
        if (!this.precioFinal) {
            return Number(this.precioMensual) * (1 - Number(this.descuentoPct || 0) / 100);
        }
        return Number(this.precioFinal);
    }
};
exports.Contrato = Contrato;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Contrato.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cliente_id' }),
    __metadata("design:type", String)
], Contrato.prototype, "clienteId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'plan_id' }),
    __metadata("design:type", String)
], Contrato.prototype, "planId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'router_id', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "routerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nodo_id', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "nodoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'onu_id', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "onuId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'segmento_id', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "segmentoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tecnico_instalacion', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "tecnicoInstalacionId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'vendedor_id', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "vendedorId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'numero_contrato', length: 30 }),
    __metadata("design:type", String)
], Contrato.prototype, "numeroContrato", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: EstadoContrato,
        default: EstadoContrato.PENDIENTE_INSTALACION,
    }),
    __metadata("design:type", String)
], Contrato.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_estado', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], Contrato.prototype, "fechaEstado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'motivo_estado', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "motivoEstado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_inicio', type: 'date' }),
    __metadata("design:type", String)
], Contrato.prototype, "fechaInicio", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_vencimiento', type: 'date', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "fechaVencimiento", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_instalacion', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Contrato.prototype, "fechaInstalacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_baja', type: 'date', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "fechaBaja", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'motivo_baja', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "motivoBaja", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'direccion_instalacion', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "direccionInstalacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'latitud_instalacion', type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Contrato.prototype, "latitudInstalacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'longitud_instalacion', type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Contrato.prototype, "longitudInstalacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'usuario_pppoe', length: 100, nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "usuarioPppoe", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'password_pppoe', length: 500, nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "passwordPppoe", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ip_asignada', type: 'inet', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "ipAsignada", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'mac_address', type: 'macaddr', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "macAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'vlan_id', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Contrato.prototype, "vlanId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nombre_queue', length: 100, nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "nombreQueue", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'precio_mensual', type: 'decimal', precision: 10, scale: 2 }),
    __metadata("design:type", Number)
], Contrato.prototype, "precioMensual", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'descuento_pct', type: 'decimal', precision: 5, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Contrato.prototype, "descuentoPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'descuento_motivo', length: 200, nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "descuentoMotivo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'precio_final', type: 'decimal', precision: 10, scale: 2, insert: false, update: false, nullable: true }),
    __metadata("design:type", Number)
], Contrato.prototype, "precioFinal", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'en_prorroga', default: false }),
    __metadata("design:type", Boolean)
], Contrato.prototype, "enProrroga", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'prorroga_hasta', type: 'date', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "prorrogaHasta", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'prorroga_motivo', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "prorrogaMotivo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'prorroga_otorgada_por', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "prorrogaOtorgadaPor", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'dia_facturacion', type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], Contrato.prototype, "diaFacturacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_ultimo_pago', type: 'date', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "fechaUltimoPago", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'deuda_total', type: 'decimal', precision: 12, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Contrato.prototype, "deudaTotal", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'meses_deuda', type: 'smallint', default: 0 }),
    __metadata("design:type", Number)
], Contrato.prototype, "mesesDeuda", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], Contrato.prototype, "aprovisionado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'aprovisionado_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Contrato.prototype, "aprovisionadoEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notas_instalacion', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "notasInstalacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notas_tecnicas', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "notasTecnicas", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notas_admin', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "notasAdmin", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_by', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'updated_by', nullable: true }),
    __metadata("design:type", String)
], Contrato.prototype, "updatedBy", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => ContratoHistorial, (h) => h.contrato),
    __metadata("design:type", Array)
], Contrato.prototype, "historial", void 0);
exports.Contrato = Contrato = __decorate([
    (0, typeorm_1.Entity)('contratos'),
    (0, typeorm_1.Index)(['empresaId', 'estado']),
    (0, typeorm_1.Index)(['empresaId', 'clienteId']),
    (0, typeorm_1.Index)(['ipAsignada']),
    (0, typeorm_1.Index)(['usuarioPppoe'])
], Contrato);
let ContratoHistorial = class ContratoHistorial {
};
exports.ContratoHistorial = ContratoHistorial;
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', primary: true, generated: 'increment' }),
    __metadata("design:type", String)
], ContratoHistorial.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'contrato_id' }),
    __metadata("design:type", String)
], ContratoHistorial.prototype, "contratoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], ContratoHistorial.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'estado_anterior',
        type: 'enum',
        enum: EstadoContrato,
        nullable: true,
    }),
    __metadata("design:type", String)
], ContratoHistorial.prototype, "estadoAnterior", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'estado_nuevo', type: 'enum', enum: EstadoContrato }),
    __metadata("design:type", String)
], ContratoHistorial.prototype, "estadoNuevo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], ContratoHistorial.prototype, "motivo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'usuario_id', nullable: true }),
    __metadata("design:type", String)
], ContratoHistorial.prototype, "usuarioId", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], ContratoHistorial.prototype, "automatico", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], ContratoHistorial.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => Contrato, (c) => c.historial),
    (0, typeorm_1.JoinColumn)({ name: 'contrato_id' }),
    __metadata("design:type", Contrato)
], ContratoHistorial.prototype, "contrato", void 0);
exports.ContratoHistorial = ContratoHistorial = __decorate([
    (0, typeorm_1.Entity)('contratos_historial'),
    (0, typeorm_1.Index)(['contratoId', 'createdAt'])
], ContratoHistorial);
//# sourceMappingURL=contrato.entity.js.map