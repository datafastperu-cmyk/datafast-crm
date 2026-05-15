"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Factura = exports.EstadoFactura = exports.TipoComprobante = void 0;
var typeorm_1 = require("typeorm");
var base_entity_1 = require("../../../common/entities/base.entity");
// ─── Enums ────────────────────────────────────────────────────
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
// ─── Entidad principal ────────────────────────────────────────
var Factura = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('facturas'), (0, typeorm_1.Index)(['empresaId', 'estado', 'fechaVencimiento']), (0, typeorm_1.Index)(['empresaId', 'clienteId', 'fechaEmision']), (0, typeorm_1.Index)(['empresaId', 'fechaEmision']), (0, typeorm_1.Index)(['contratoId'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _classSuper = base_entity_1.BaseModel;
    var _empresaId_decorators;
    var _empresaId_initializers = [];
    var _empresaId_extraInitializers = [];
    var _clienteId_decorators;
    var _clienteId_initializers = [];
    var _clienteId_extraInitializers = [];
    var _contratoId_decorators;
    var _contratoId_initializers = [];
    var _contratoId_extraInitializers = [];
    var _tipoComprobante_decorators;
    var _tipoComprobante_initializers = [];
    var _tipoComprobante_extraInitializers = [];
    var _serie_decorators;
    var _serie_initializers = [];
    var _serie_extraInitializers = [];
    var _correlativo_decorators;
    var _correlativo_initializers = [];
    var _correlativo_extraInitializers = [];
    var _numeroCompleto_decorators;
    var _numeroCompleto_initializers = [];
    var _numeroCompleto_extraInitializers = [];
    var _periodoInicio_decorators;
    var _periodoInicio_initializers = [];
    var _periodoInicio_extraInitializers = [];
    var _periodoFin_decorators;
    var _periodoFin_initializers = [];
    var _periodoFin_extraInitializers = [];
    var _descripcion_decorators;
    var _descripcion_initializers = [];
    var _descripcion_extraInitializers = [];
    var _subtotal_decorators;
    var _subtotal_initializers = [];
    var _subtotal_extraInitializers = [];
    var _descuento_decorators;
    var _descuento_initializers = [];
    var _descuento_extraInitializers = [];
    var _baseImponible_decorators;
    var _baseImponible_initializers = [];
    var _baseImponible_extraInitializers = [];
    var _igv_decorators;
    var _igv_initializers = [];
    var _igv_extraInitializers = [];
    var _total_decorators;
    var _total_initializers = [];
    var _total_extraInitializers = [];
    var _montoPagado_decorators;
    var _montoPagado_initializers = [];
    var _montoPagado_extraInitializers = [];
    var _saldo_decorators;
    var _saldo_initializers = [];
    var _saldo_extraInitializers = [];
    var _moneda_decorators;
    var _moneda_initializers = [];
    var _moneda_extraInitializers = [];
    var _tipoCambio_decorators;
    var _tipoCambio_initializers = [];
    var _tipoCambio_extraInitializers = [];
    var _estado_decorators;
    var _estado_initializers = [];
    var _estado_extraInitializers = [];
    var _fechaEmision_decorators;
    var _fechaEmision_initializers = [];
    var _fechaEmision_extraInitializers = [];
    var _fechaVencimiento_decorators;
    var _fechaVencimiento_initializers = [];
    var _fechaVencimiento_extraInitializers = [];
    var _fechaPago_decorators;
    var _fechaPago_initializers = [];
    var _fechaPago_extraInitializers = [];
    var _items_decorators;
    var _items_initializers = [];
    var _items_extraInitializers = [];
    var _pdfUrl_decorators;
    var _pdfUrl_initializers = [];
    var _pdfUrl_extraInitializers = [];
    var _pdfGeneradoEn_decorators;
    var _pdfGeneradoEn_initializers = [];
    var _pdfGeneradoEn_extraInitializers = [];
    var _sunatEnviada_decorators;
    var _sunatEnviada_initializers = [];
    var _sunatEnviada_extraInitializers = [];
    var _sunatAceptada_decorators;
    var _sunatAceptada_initializers = [];
    var _sunatAceptada_extraInitializers = [];
    var _sunatCodigoHash_decorators;
    var _sunatCodigoHash_initializers = [];
    var _sunatCodigoHash_extraInitializers = [];
    var _sunatError_decorators;
    var _sunatError_initializers = [];
    var _sunatError_extraInitializers = [];
    var _sunatEnviadaEn_decorators;
    var _sunatEnviadaEn_initializers = [];
    var _sunatEnviadaEn_extraInitializers = [];
    var _facturaOriginalId_decorators;
    var _facturaOriginalId_initializers = [];
    var _facturaOriginalId_extraInitializers = [];
    var _motivoAnulacion_decorators;
    var _motivoAnulacion_initializers = [];
    var _motivoAnulacion_extraInitializers = [];
    var _anuladaEn_decorators;
    var _anuladaEn_initializers = [];
    var _anuladaEn_extraInitializers = [];
    var _anuladaPor_decorators;
    var _anuladaPor_initializers = [];
    var _anuladaPor_extraInitializers = [];
    var _generadaAutomaticamente_decorators;
    var _generadaAutomaticamente_initializers = [];
    var _generadaAutomaticamente_extraInitializers = [];
    var _enviadaPorEmail_decorators;
    var _enviadaPorEmail_initializers = [];
    var _enviadaPorEmail_extraInitializers = [];
    var _enviadaPorWhatsapp_decorators;
    var _enviadaPorWhatsapp_initializers = [];
    var _enviadaPorWhatsapp_extraInitializers = [];
    var _createdBy_decorators;
    var _createdBy_initializers = [];
    var _createdBy_extraInitializers = [];
    var Factura = _classThis = /** @class */ (function (_super) {
        __extends(Factura_1, _super);
        function Factura_1() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.empresaId = __runInitializers(_this, _empresaId_initializers, void 0);
            _this.clienteId = (__runInitializers(_this, _empresaId_extraInitializers), __runInitializers(_this, _clienteId_initializers, void 0));
            _this.contratoId = (__runInitializers(_this, _clienteId_extraInitializers), __runInitializers(_this, _contratoId_initializers, void 0));
            // ── Numeración SUNAT ──────────────────────────────────────
            _this.tipoComprobante = (__runInitializers(_this, _contratoId_extraInitializers), __runInitializers(_this, _tipoComprobante_initializers, void 0));
            _this.serie = (__runInitializers(_this, _tipoComprobante_extraInitializers), __runInitializers(_this, _serie_initializers, void 0)); // 'B001', 'F001'
            _this.correlativo = (__runInitializers(_this, _serie_extraInitializers), __runInitializers(_this, _correlativo_initializers, void 0)); // 1, 2, 3...
            // numero_completo es columna generada en BD (serie || '-' || correlativo)
            _this.numeroCompleto = (__runInitializers(_this, _correlativo_extraInitializers), __runInitializers(_this, _numeroCompleto_initializers, void 0));
            // ── Periodo facturado ────────────────────────────────────
            _this.periodoInicio = (__runInitializers(_this, _numeroCompleto_extraInitializers), __runInitializers(_this, _periodoInicio_initializers, void 0));
            _this.periodoFin = (__runInitializers(_this, _periodoInicio_extraInitializers), __runInitializers(_this, _periodoFin_initializers, void 0));
            _this.descripcion = (__runInitializers(_this, _periodoFin_extraInitializers), __runInitializers(_this, _descripcion_initializers, void 0));
            // ── Montos ───────────────────────────────────────────────
            _this.subtotal = (__runInitializers(_this, _descripcion_extraInitializers), __runInitializers(_this, _subtotal_initializers, void 0));
            _this.descuento = (__runInitializers(_this, _subtotal_extraInitializers), __runInitializers(_this, _descuento_initializers, void 0));
            // base_imponible = subtotal - descuento (columna generada en BD)
            _this.baseImponible = (__runInitializers(_this, _descuento_extraInitializers), __runInitializers(_this, _baseImponible_initializers, void 0));
            _this.igv = (__runInitializers(_this, _baseImponible_extraInitializers), __runInitializers(_this, _igv_initializers, void 0));
            _this.total = (__runInitializers(_this, _igv_extraInitializers), __runInitializers(_this, _total_initializers, void 0));
            _this.montoPagado = (__runInitializers(_this, _total_extraInitializers), __runInitializers(_this, _montoPagado_initializers, void 0));
            // saldo = total - monto_pagado (columna generada en BD)
            _this.saldo = (__runInitializers(_this, _montoPagado_extraInitializers), __runInitializers(_this, _saldo_initializers, void 0));
            // ── Moneda ───────────────────────────────────────────────
            _this.moneda = (__runInitializers(_this, _saldo_extraInitializers), __runInitializers(_this, _moneda_initializers, void 0));
            _this.tipoCambio = (__runInitializers(_this, _moneda_extraInitializers), __runInitializers(_this, _tipoCambio_initializers, void 0));
            // ── Estado y fechas ──────────────────────────────────────
            _this.estado = (__runInitializers(_this, _tipoCambio_extraInitializers), __runInitializers(_this, _estado_initializers, void 0));
            _this.fechaEmision = (__runInitializers(_this, _estado_extraInitializers), __runInitializers(_this, _fechaEmision_initializers, void 0));
            _this.fechaVencimiento = (__runInitializers(_this, _fechaEmision_extraInitializers), __runInitializers(_this, _fechaVencimiento_initializers, void 0));
            _this.fechaPago = (__runInitializers(_this, _fechaVencimiento_extraInitializers), __runInitializers(_this, _fechaPago_initializers, void 0));
            // ── Items detallados (JSONB) ──────────────────────────────
            _this.items = (__runInitializers(_this, _fechaPago_extraInitializers), __runInitializers(_this, _items_initializers, void 0));
            // ── PDF ──────────────────────────────────────────────────
            _this.pdfUrl = (__runInitializers(_this, _items_extraInitializers), __runInitializers(_this, _pdfUrl_initializers, void 0));
            _this.pdfGeneradoEn = (__runInitializers(_this, _pdfUrl_extraInitializers), __runInitializers(_this, _pdfGeneradoEn_initializers, void 0));
            // ── SUNAT ────────────────────────────────────────────────
            _this.sunatEnviada = (__runInitializers(_this, _pdfGeneradoEn_extraInitializers), __runInitializers(_this, _sunatEnviada_initializers, void 0));
            _this.sunatAceptada = (__runInitializers(_this, _sunatEnviada_extraInitializers), __runInitializers(_this, _sunatAceptada_initializers, void 0));
            _this.sunatCodigoHash = (__runInitializers(_this, _sunatAceptada_extraInitializers), __runInitializers(_this, _sunatCodigoHash_initializers, void 0));
            _this.sunatError = (__runInitializers(_this, _sunatCodigoHash_extraInitializers), __runInitializers(_this, _sunatError_initializers, void 0));
            _this.sunatEnviadaEn = (__runInitializers(_this, _sunatError_extraInitializers), __runInitializers(_this, _sunatEnviadaEn_initializers, void 0));
            // ── Nota de crédito / anulación ──────────────────────────
            _this.facturaOriginalId = (__runInitializers(_this, _sunatEnviadaEn_extraInitializers), __runInitializers(_this, _facturaOriginalId_initializers, void 0));
            _this.motivoAnulacion = (__runInitializers(_this, _facturaOriginalId_extraInitializers), __runInitializers(_this, _motivoAnulacion_initializers, void 0));
            _this.anuladaEn = (__runInitializers(_this, _motivoAnulacion_extraInitializers), __runInitializers(_this, _anuladaEn_initializers, void 0));
            _this.anuladaPor = (__runInitializers(_this, _anuladaEn_extraInitializers), __runInitializers(_this, _anuladaPor_initializers, void 0));
            // ── Flags de envío ────────────────────────────────────────
            _this.generadaAutomaticamente = (__runInitializers(_this, _anuladaPor_extraInitializers), __runInitializers(_this, _generadaAutomaticamente_initializers, void 0));
            _this.enviadaPorEmail = (__runInitializers(_this, _generadaAutomaticamente_extraInitializers), __runInitializers(_this, _enviadaPorEmail_initializers, void 0));
            _this.enviadaPorWhatsapp = (__runInitializers(_this, _enviadaPorEmail_extraInitializers), __runInitializers(_this, _enviadaPorWhatsapp_initializers, void 0));
            // ── Auditoría ────────────────────────────────────────────
            _this.createdBy = (__runInitializers(_this, _enviadaPorWhatsapp_extraInitializers), __runInitializers(_this, _createdBy_initializers, void 0));
            __runInitializers(_this, _createdBy_extraInitializers);
            return _this;
        }
        Object.defineProperty(Factura_1.prototype, "estaVencida", {
            // ── Helpers computados ───────────────────────────────────
            get: function () {
                if (this.estado === EstadoFactura.PAGADA)
                    return false;
                return new Date(this.fechaVencimiento) < new Date();
            },
            enumerable: false,
            configurable: true
        });
        Object.defineProperty(Factura_1.prototype, "esPagada", {
            get: function () {
                return [EstadoFactura.PAGADA].includes(this.estado);
            },
            enumerable: false,
            configurable: true
        });
        Object.defineProperty(Factura_1.prototype, "saldoPendiente", {
            get: function () {
                return Math.max(0, Number(this.total) - Number(this.montoPagado));
            },
            enumerable: false,
            configurable: true
        });
        Object.defineProperty(Factura_1.prototype, "diasVencida", {
            get: function () {
                if (!this.estaVencida)
                    return 0;
                var diff = Date.now() - new Date(this.fechaVencimiento).getTime();
                return Math.floor(diff / (1000 * 60 * 60 * 24));
            },
            enumerable: false,
            configurable: true
        });
        return Factura_1;
    }(_classSuper));
    __setFunctionName(_classThis, "Factura");
    (function () {
        var _a;
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create((_a = _classSuper[Symbol.metadata]) !== null && _a !== void 0 ? _a : null) : void 0;
        _empresaId_decorators = [(0, typeorm_1.Column)({ name: 'empresa_id' })];
        _clienteId_decorators = [(0, typeorm_1.Column)({ name: 'cliente_id' })];
        _contratoId_decorators = [(0, typeorm_1.Column)({ name: 'contrato_id', nullable: true })];
        _tipoComprobante_decorators = [(0, typeorm_1.Column)({
                name: 'tipo_comprobante',
                type: 'enum',
                enum: TipoComprobante,
                default: TipoComprobante.BOLETA,
            })];
        _serie_decorators = [(0, typeorm_1.Column)({ length: 10 })];
        _correlativo_decorators = [(0, typeorm_1.Column)({ type: 'int' })];
        _numeroCompleto_decorators = [(0, typeorm_1.Column)({
                name: 'numero_completo',
                insert: false,
                update: false,
                nullable: true,
            })];
        _periodoInicio_decorators = [(0, typeorm_1.Column)({ name: 'periodo_inicio', type: 'date' })];
        _periodoFin_decorators = [(0, typeorm_1.Column)({ name: 'periodo_fin', type: 'date' })];
        _descripcion_decorators = [(0, typeorm_1.Column)({ type: 'text', default: 'Servicio de internet' })];
        _subtotal_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2 })];
        _descuento_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2, default: 0 })];
        _baseImponible_decorators = [(0, typeorm_1.Column)({
                name: 'base_imponible',
                type: 'decimal',
                precision: 12,
                scale: 2,
                insert: false,
                update: false,
                nullable: true,
            })];
        _igv_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2, default: 0 })];
        _total_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2 })];
        _montoPagado_decorators = [(0, typeorm_1.Column)({
                name: 'monto_pagado',
                type: 'decimal',
                precision: 12,
                scale: 2,
                default: 0,
            })];
        _saldo_decorators = [(0, typeorm_1.Column)({
                type: 'decimal',
                precision: 12,
                scale: 2,
                insert: false,
                update: false,
                nullable: true,
            })];
        _moneda_decorators = [(0, typeorm_1.Column)({ length: 10, default: 'PEN' })];
        _tipoCambio_decorators = [(0, typeorm_1.Column)({
                name: 'tipo_cambio',
                type: 'decimal',
                precision: 8,
                scale: 4,
                default: 1.0,
            })];
        _estado_decorators = [(0, typeorm_1.Column)({ type: 'enum', enum: EstadoFactura, default: EstadoFactura.EMITIDA })];
        _fechaEmision_decorators = [(0, typeorm_1.Column)({ name: 'fecha_emision', type: 'date', default: function () { return 'CURRENT_DATE'; } })];
        _fechaVencimiento_decorators = [(0, typeorm_1.Column)({ name: 'fecha_vencimiento', type: 'date' })];
        _fechaPago_decorators = [(0, typeorm_1.Column)({ name: 'fecha_pago', type: 'date', nullable: true })];
        _items_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', default: '[]' })];
        _pdfUrl_decorators = [(0, typeorm_1.Column)({ name: 'pdf_url', length: 500, nullable: true })];
        _pdfGeneradoEn_decorators = [(0, typeorm_1.Column)({ name: 'pdf_generado_en', type: 'timestamptz', nullable: true })];
        _sunatEnviada_decorators = [(0, typeorm_1.Column)({ name: 'sunat_enviada', default: false })];
        _sunatAceptada_decorators = [(0, typeorm_1.Column)({ name: 'sunat_aceptada', nullable: true })];
        _sunatCodigoHash_decorators = [(0, typeorm_1.Column)({ name: 'sunat_codigo_hash', length: 200, nullable: true })];
        _sunatError_decorators = [(0, typeorm_1.Column)({ name: 'sunat_error', type: 'text', nullable: true })];
        _sunatEnviadaEn_decorators = [(0, typeorm_1.Column)({ name: 'sunat_enviada_en', type: 'timestamptz', nullable: true })];
        _facturaOriginalId_decorators = [(0, typeorm_1.Column)({ name: 'factura_original_id', nullable: true })];
        _motivoAnulacion_decorators = [(0, typeorm_1.Column)({ name: 'motivo_anulacion', type: 'text', nullable: true })];
        _anuladaEn_decorators = [(0, typeorm_1.Column)({ name: 'anulada_en', type: 'timestamptz', nullable: true })];
        _anuladaPor_decorators = [(0, typeorm_1.Column)({ name: 'anulada_por', nullable: true })];
        _generadaAutomaticamente_decorators = [(0, typeorm_1.Column)({ name: 'generada_automaticamente', default: false })];
        _enviadaPorEmail_decorators = [(0, typeorm_1.Column)({ name: 'enviada_por_email', default: false })];
        _enviadaPorWhatsapp_decorators = [(0, typeorm_1.Column)({ name: 'enviada_por_whatsapp', default: false })];
        _createdBy_decorators = [(0, typeorm_1.Column)({ name: 'created_by', nullable: true })];
        __esDecorate(null, null, _empresaId_decorators, { kind: "field", name: "empresaId", static: false, private: false, access: { has: function (obj) { return "empresaId" in obj; }, get: function (obj) { return obj.empresaId; }, set: function (obj, value) { obj.empresaId = value; } }, metadata: _metadata }, _empresaId_initializers, _empresaId_extraInitializers);
        __esDecorate(null, null, _clienteId_decorators, { kind: "field", name: "clienteId", static: false, private: false, access: { has: function (obj) { return "clienteId" in obj; }, get: function (obj) { return obj.clienteId; }, set: function (obj, value) { obj.clienteId = value; } }, metadata: _metadata }, _clienteId_initializers, _clienteId_extraInitializers);
        __esDecorate(null, null, _contratoId_decorators, { kind: "field", name: "contratoId", static: false, private: false, access: { has: function (obj) { return "contratoId" in obj; }, get: function (obj) { return obj.contratoId; }, set: function (obj, value) { obj.contratoId = value; } }, metadata: _metadata }, _contratoId_initializers, _contratoId_extraInitializers);
        __esDecorate(null, null, _tipoComprobante_decorators, { kind: "field", name: "tipoComprobante", static: false, private: false, access: { has: function (obj) { return "tipoComprobante" in obj; }, get: function (obj) { return obj.tipoComprobante; }, set: function (obj, value) { obj.tipoComprobante = value; } }, metadata: _metadata }, _tipoComprobante_initializers, _tipoComprobante_extraInitializers);
        __esDecorate(null, null, _serie_decorators, { kind: "field", name: "serie", static: false, private: false, access: { has: function (obj) { return "serie" in obj; }, get: function (obj) { return obj.serie; }, set: function (obj, value) { obj.serie = value; } }, metadata: _metadata }, _serie_initializers, _serie_extraInitializers);
        __esDecorate(null, null, _correlativo_decorators, { kind: "field", name: "correlativo", static: false, private: false, access: { has: function (obj) { return "correlativo" in obj; }, get: function (obj) { return obj.correlativo; }, set: function (obj, value) { obj.correlativo = value; } }, metadata: _metadata }, _correlativo_initializers, _correlativo_extraInitializers);
        __esDecorate(null, null, _numeroCompleto_decorators, { kind: "field", name: "numeroCompleto", static: false, private: false, access: { has: function (obj) { return "numeroCompleto" in obj; }, get: function (obj) { return obj.numeroCompleto; }, set: function (obj, value) { obj.numeroCompleto = value; } }, metadata: _metadata }, _numeroCompleto_initializers, _numeroCompleto_extraInitializers);
        __esDecorate(null, null, _periodoInicio_decorators, { kind: "field", name: "periodoInicio", static: false, private: false, access: { has: function (obj) { return "periodoInicio" in obj; }, get: function (obj) { return obj.periodoInicio; }, set: function (obj, value) { obj.periodoInicio = value; } }, metadata: _metadata }, _periodoInicio_initializers, _periodoInicio_extraInitializers);
        __esDecorate(null, null, _periodoFin_decorators, { kind: "field", name: "periodoFin", static: false, private: false, access: { has: function (obj) { return "periodoFin" in obj; }, get: function (obj) { return obj.periodoFin; }, set: function (obj, value) { obj.periodoFin = value; } }, metadata: _metadata }, _periodoFin_initializers, _periodoFin_extraInitializers);
        __esDecorate(null, null, _descripcion_decorators, { kind: "field", name: "descripcion", static: false, private: false, access: { has: function (obj) { return "descripcion" in obj; }, get: function (obj) { return obj.descripcion; }, set: function (obj, value) { obj.descripcion = value; } }, metadata: _metadata }, _descripcion_initializers, _descripcion_extraInitializers);
        __esDecorate(null, null, _subtotal_decorators, { kind: "field", name: "subtotal", static: false, private: false, access: { has: function (obj) { return "subtotal" in obj; }, get: function (obj) { return obj.subtotal; }, set: function (obj, value) { obj.subtotal = value; } }, metadata: _metadata }, _subtotal_initializers, _subtotal_extraInitializers);
        __esDecorate(null, null, _descuento_decorators, { kind: "field", name: "descuento", static: false, private: false, access: { has: function (obj) { return "descuento" in obj; }, get: function (obj) { return obj.descuento; }, set: function (obj, value) { obj.descuento = value; } }, metadata: _metadata }, _descuento_initializers, _descuento_extraInitializers);
        __esDecorate(null, null, _baseImponible_decorators, { kind: "field", name: "baseImponible", static: false, private: false, access: { has: function (obj) { return "baseImponible" in obj; }, get: function (obj) { return obj.baseImponible; }, set: function (obj, value) { obj.baseImponible = value; } }, metadata: _metadata }, _baseImponible_initializers, _baseImponible_extraInitializers);
        __esDecorate(null, null, _igv_decorators, { kind: "field", name: "igv", static: false, private: false, access: { has: function (obj) { return "igv" in obj; }, get: function (obj) { return obj.igv; }, set: function (obj, value) { obj.igv = value; } }, metadata: _metadata }, _igv_initializers, _igv_extraInitializers);
        __esDecorate(null, null, _total_decorators, { kind: "field", name: "total", static: false, private: false, access: { has: function (obj) { return "total" in obj; }, get: function (obj) { return obj.total; }, set: function (obj, value) { obj.total = value; } }, metadata: _metadata }, _total_initializers, _total_extraInitializers);
        __esDecorate(null, null, _montoPagado_decorators, { kind: "field", name: "montoPagado", static: false, private: false, access: { has: function (obj) { return "montoPagado" in obj; }, get: function (obj) { return obj.montoPagado; }, set: function (obj, value) { obj.montoPagado = value; } }, metadata: _metadata }, _montoPagado_initializers, _montoPagado_extraInitializers);
        __esDecorate(null, null, _saldo_decorators, { kind: "field", name: "saldo", static: false, private: false, access: { has: function (obj) { return "saldo" in obj; }, get: function (obj) { return obj.saldo; }, set: function (obj, value) { obj.saldo = value; } }, metadata: _metadata }, _saldo_initializers, _saldo_extraInitializers);
        __esDecorate(null, null, _moneda_decorators, { kind: "field", name: "moneda", static: false, private: false, access: { has: function (obj) { return "moneda" in obj; }, get: function (obj) { return obj.moneda; }, set: function (obj, value) { obj.moneda = value; } }, metadata: _metadata }, _moneda_initializers, _moneda_extraInitializers);
        __esDecorate(null, null, _tipoCambio_decorators, { kind: "field", name: "tipoCambio", static: false, private: false, access: { has: function (obj) { return "tipoCambio" in obj; }, get: function (obj) { return obj.tipoCambio; }, set: function (obj, value) { obj.tipoCambio = value; } }, metadata: _metadata }, _tipoCambio_initializers, _tipoCambio_extraInitializers);
        __esDecorate(null, null, _estado_decorators, { kind: "field", name: "estado", static: false, private: false, access: { has: function (obj) { return "estado" in obj; }, get: function (obj) { return obj.estado; }, set: function (obj, value) { obj.estado = value; } }, metadata: _metadata }, _estado_initializers, _estado_extraInitializers);
        __esDecorate(null, null, _fechaEmision_decorators, { kind: "field", name: "fechaEmision", static: false, private: false, access: { has: function (obj) { return "fechaEmision" in obj; }, get: function (obj) { return obj.fechaEmision; }, set: function (obj, value) { obj.fechaEmision = value; } }, metadata: _metadata }, _fechaEmision_initializers, _fechaEmision_extraInitializers);
        __esDecorate(null, null, _fechaVencimiento_decorators, { kind: "field", name: "fechaVencimiento", static: false, private: false, access: { has: function (obj) { return "fechaVencimiento" in obj; }, get: function (obj) { return obj.fechaVencimiento; }, set: function (obj, value) { obj.fechaVencimiento = value; } }, metadata: _metadata }, _fechaVencimiento_initializers, _fechaVencimiento_extraInitializers);
        __esDecorate(null, null, _fechaPago_decorators, { kind: "field", name: "fechaPago", static: false, private: false, access: { has: function (obj) { return "fechaPago" in obj; }, get: function (obj) { return obj.fechaPago; }, set: function (obj, value) { obj.fechaPago = value; } }, metadata: _metadata }, _fechaPago_initializers, _fechaPago_extraInitializers);
        __esDecorate(null, null, _items_decorators, { kind: "field", name: "items", static: false, private: false, access: { has: function (obj) { return "items" in obj; }, get: function (obj) { return obj.items; }, set: function (obj, value) { obj.items = value; } }, metadata: _metadata }, _items_initializers, _items_extraInitializers);
        __esDecorate(null, null, _pdfUrl_decorators, { kind: "field", name: "pdfUrl", static: false, private: false, access: { has: function (obj) { return "pdfUrl" in obj; }, get: function (obj) { return obj.pdfUrl; }, set: function (obj, value) { obj.pdfUrl = value; } }, metadata: _metadata }, _pdfUrl_initializers, _pdfUrl_extraInitializers);
        __esDecorate(null, null, _pdfGeneradoEn_decorators, { kind: "field", name: "pdfGeneradoEn", static: false, private: false, access: { has: function (obj) { return "pdfGeneradoEn" in obj; }, get: function (obj) { return obj.pdfGeneradoEn; }, set: function (obj, value) { obj.pdfGeneradoEn = value; } }, metadata: _metadata }, _pdfGeneradoEn_initializers, _pdfGeneradoEn_extraInitializers);
        __esDecorate(null, null, _sunatEnviada_decorators, { kind: "field", name: "sunatEnviada", static: false, private: false, access: { has: function (obj) { return "sunatEnviada" in obj; }, get: function (obj) { return obj.sunatEnviada; }, set: function (obj, value) { obj.sunatEnviada = value; } }, metadata: _metadata }, _sunatEnviada_initializers, _sunatEnviada_extraInitializers);
        __esDecorate(null, null, _sunatAceptada_decorators, { kind: "field", name: "sunatAceptada", static: false, private: false, access: { has: function (obj) { return "sunatAceptada" in obj; }, get: function (obj) { return obj.sunatAceptada; }, set: function (obj, value) { obj.sunatAceptada = value; } }, metadata: _metadata }, _sunatAceptada_initializers, _sunatAceptada_extraInitializers);
        __esDecorate(null, null, _sunatCodigoHash_decorators, { kind: "field", name: "sunatCodigoHash", static: false, private: false, access: { has: function (obj) { return "sunatCodigoHash" in obj; }, get: function (obj) { return obj.sunatCodigoHash; }, set: function (obj, value) { obj.sunatCodigoHash = value; } }, metadata: _metadata }, _sunatCodigoHash_initializers, _sunatCodigoHash_extraInitializers);
        __esDecorate(null, null, _sunatError_decorators, { kind: "field", name: "sunatError", static: false, private: false, access: { has: function (obj) { return "sunatError" in obj; }, get: function (obj) { return obj.sunatError; }, set: function (obj, value) { obj.sunatError = value; } }, metadata: _metadata }, _sunatError_initializers, _sunatError_extraInitializers);
        __esDecorate(null, null, _sunatEnviadaEn_decorators, { kind: "field", name: "sunatEnviadaEn", static: false, private: false, access: { has: function (obj) { return "sunatEnviadaEn" in obj; }, get: function (obj) { return obj.sunatEnviadaEn; }, set: function (obj, value) { obj.sunatEnviadaEn = value; } }, metadata: _metadata }, _sunatEnviadaEn_initializers, _sunatEnviadaEn_extraInitializers);
        __esDecorate(null, null, _facturaOriginalId_decorators, { kind: "field", name: "facturaOriginalId", static: false, private: false, access: { has: function (obj) { return "facturaOriginalId" in obj; }, get: function (obj) { return obj.facturaOriginalId; }, set: function (obj, value) { obj.facturaOriginalId = value; } }, metadata: _metadata }, _facturaOriginalId_initializers, _facturaOriginalId_extraInitializers);
        __esDecorate(null, null, _motivoAnulacion_decorators, { kind: "field", name: "motivoAnulacion", static: false, private: false, access: { has: function (obj) { return "motivoAnulacion" in obj; }, get: function (obj) { return obj.motivoAnulacion; }, set: function (obj, value) { obj.motivoAnulacion = value; } }, metadata: _metadata }, _motivoAnulacion_initializers, _motivoAnulacion_extraInitializers);
        __esDecorate(null, null, _anuladaEn_decorators, { kind: "field", name: "anuladaEn", static: false, private: false, access: { has: function (obj) { return "anuladaEn" in obj; }, get: function (obj) { return obj.anuladaEn; }, set: function (obj, value) { obj.anuladaEn = value; } }, metadata: _metadata }, _anuladaEn_initializers, _anuladaEn_extraInitializers);
        __esDecorate(null, null, _anuladaPor_decorators, { kind: "field", name: "anuladaPor", static: false, private: false, access: { has: function (obj) { return "anuladaPor" in obj; }, get: function (obj) { return obj.anuladaPor; }, set: function (obj, value) { obj.anuladaPor = value; } }, metadata: _metadata }, _anuladaPor_initializers, _anuladaPor_extraInitializers);
        __esDecorate(null, null, _generadaAutomaticamente_decorators, { kind: "field", name: "generadaAutomaticamente", static: false, private: false, access: { has: function (obj) { return "generadaAutomaticamente" in obj; }, get: function (obj) { return obj.generadaAutomaticamente; }, set: function (obj, value) { obj.generadaAutomaticamente = value; } }, metadata: _metadata }, _generadaAutomaticamente_initializers, _generadaAutomaticamente_extraInitializers);
        __esDecorate(null, null, _enviadaPorEmail_decorators, { kind: "field", name: "enviadaPorEmail", static: false, private: false, access: { has: function (obj) { return "enviadaPorEmail" in obj; }, get: function (obj) { return obj.enviadaPorEmail; }, set: function (obj, value) { obj.enviadaPorEmail = value; } }, metadata: _metadata }, _enviadaPorEmail_initializers, _enviadaPorEmail_extraInitializers);
        __esDecorate(null, null, _enviadaPorWhatsapp_decorators, { kind: "field", name: "enviadaPorWhatsapp", static: false, private: false, access: { has: function (obj) { return "enviadaPorWhatsapp" in obj; }, get: function (obj) { return obj.enviadaPorWhatsapp; }, set: function (obj, value) { obj.enviadaPorWhatsapp = value; } }, metadata: _metadata }, _enviadaPorWhatsapp_initializers, _enviadaPorWhatsapp_extraInitializers);
        __esDecorate(null, null, _createdBy_decorators, { kind: "field", name: "createdBy", static: false, private: false, access: { has: function (obj) { return "createdBy" in obj; }, get: function (obj) { return obj.createdBy; }, set: function (obj, value) { obj.createdBy = value; } }, metadata: _metadata }, _createdBy_initializers, _createdBy_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        Factura = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return Factura = _classThis;
}();
exports.Factura = Factura;
