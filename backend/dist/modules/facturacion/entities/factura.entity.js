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
exports.Factura = exports.EstadoFactura = exports.TipoComprobante = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
var TipoComprobante;
(function (TipoComprobante) {
    TipoComprobante["BOLETA"] = "boleta";
    TipoComprobante["FACTURA"] = "factura";
    TipoComprobante["NOTA_CREDITO"] = "nota_credito";
    TipoComprobante["NOTA_DEBITO"] = "nota_debito";
    TipoComprobante["RECIBO_INTERNO"] = "recibo_interno";
})(TipoComprobante || (exports.TipoComprobante = TipoComprobante = {}));
var EstadoFactura;
(function (EstadoFactura) {
    EstadoFactura["BORRADOR"] = "borrador";
    EstadoFactura["EMITIDA"] = "emitida";
    EstadoFactura["PAGADA"] = "pagada";
    EstadoFactura["PAGADA_PARCIAL"] = "pagada_parcial";
    EstadoFactura["VENCIDA"] = "vencida";
    EstadoFactura["ANULADA"] = "anulada";
    EstadoFactura["EN_COBRANZA"] = "en_cobranza";
})(EstadoFactura || (exports.EstadoFactura = EstadoFactura = {}));
let Factura = class Factura extends base_entity_1.BaseModel {
    get estaVencida() {
        if (this.estado === EstadoFactura.PAGADA)
            return false;
        return new Date(this.fechaVencimiento) < new Date();
    }
    get esPagada() {
        return [EstadoFactura.PAGADA].includes(this.estado);
    }
    get saldoPendiente() {
        return Math.max(0, Number(this.total) - Number(this.montoPagado));
    }
    get diasVencida() {
        if (!this.estaVencida)
            return 0;
        const diff = Date.now() - new Date(this.fechaVencimiento).getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    }
};
exports.Factura = Factura;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Factura.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cliente_id' }),
    __metadata("design:type", String)
], Factura.prototype, "clienteId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'contrato_id', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "contratoId", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'tipo_comprobante',
        type: 'enum',
        enum: TipoComprobante,
        default: TipoComprobante.BOLETA,
    }),
    __metadata("design:type", String)
], Factura.prototype, "tipoComprobante", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10 }),
    __metadata("design:type", String)
], Factura.prototype, "serie", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], Factura.prototype, "correlativo", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'numero_completo',
        insert: false,
        update: false,
        nullable: true,
    }),
    __metadata("design:type", String)
], Factura.prototype, "numeroCompleto", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'periodo_inicio', type: 'date' }),
    __metadata("design:type", String)
], Factura.prototype, "periodoInicio", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'periodo_fin', type: 'date' }),
    __metadata("design:type", String)
], Factura.prototype, "periodoFin", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: 'Servicio de internet' }),
    __metadata("design:type", String)
], Factura.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2 }),
    __metadata("design:type", Number)
], Factura.prototype, "subtotal", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "descuento", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'base_imponible',
        type: 'decimal',
        precision: 12,
        scale: 2,
        insert: false,
        update: false,
        nullable: true,
    }),
    __metadata("design:type", Number)
], Factura.prototype, "baseImponible", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "igv", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2 }),
    __metadata("design:type", Number)
], Factura.prototype, "total", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'monto_pagado',
        type: 'decimal',
        precision: 12,
        scale: 2,
        default: 0,
    }),
    __metadata("design:type", Number)
], Factura.prototype, "montoPagado", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 12,
        scale: 2,
        insert: false,
        update: false,
        nullable: true,
    }),
    __metadata("design:type", Number)
], Factura.prototype, "saldo", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, default: 'PEN' }),
    __metadata("design:type", String)
], Factura.prototype, "moneda", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'tipo_cambio',
        type: 'decimal',
        precision: 8,
        scale: 4,
        default: 1.0,
    }),
    __metadata("design:type", Number)
], Factura.prototype, "tipoCambio", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: EstadoFactura, default: EstadoFactura.EMITIDA }),
    __metadata("design:type", String)
], Factura.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_emision', type: 'date', default: () => 'CURRENT_DATE' }),
    __metadata("design:type", String)
], Factura.prototype, "fechaEmision", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_vencimiento', type: 'date' }),
    __metadata("design:type", String)
], Factura.prototype, "fechaVencimiento", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_pago', type: 'date', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "fechaPago", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: '[]' }),
    __metadata("design:type", Array)
], Factura.prototype, "items", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pdf_url', length: 500, nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "pdfUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'pdf_generado_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Factura.prototype, "pdfGeneradoEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sunat_enviada', default: false }),
    __metadata("design:type", Boolean)
], Factura.prototype, "sunatEnviada", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sunat_aceptada', nullable: true }),
    __metadata("design:type", Boolean)
], Factura.prototype, "sunatAceptada", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sunat_codigo_hash', length: 200, nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "sunatCodigoHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sunat_error', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "sunatError", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sunat_enviada_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Factura.prototype, "sunatEnviadaEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'factura_original_id', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "facturaOriginalId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'motivo_anulacion', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "motivoAnulacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'anulada_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Factura.prototype, "anuladaEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'anulada_por', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "anuladaPor", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'generada_automaticamente', default: false }),
    __metadata("design:type", Boolean)
], Factura.prototype, "generadaAutomaticamente", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'enviada_por_email', default: false }),
    __metadata("design:type", Boolean)
], Factura.prototype, "enviadaPorEmail", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'enviada_por_whatsapp', default: false }),
    __metadata("design:type", Boolean)
], Factura.prototype, "enviadaPorWhatsapp", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_by', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "createdBy", void 0);
exports.Factura = Factura = __decorate([
    (0, typeorm_1.Entity)('facturas'),
    (0, typeorm_1.Index)(['empresaId', 'estado', 'fechaVencimiento']),
    (0, typeorm_1.Index)(['empresaId', 'clienteId', 'fechaEmision']),
    (0, typeorm_1.Index)(['empresaId', 'fechaEmision']),
    (0, typeorm_1.Index)(['contratoId'])
], Factura);
//# sourceMappingURL=factura.entity.js.map