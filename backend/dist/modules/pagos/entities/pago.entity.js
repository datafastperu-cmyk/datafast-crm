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
exports.CuentaBancaria = exports.Pago = exports.EstadoPago = exports.MetodoPago = void 0;
const typeorm_1 = require("typeorm");
var MetodoPago;
(function (MetodoPago) {
    MetodoPago["EFECTIVO"] = "efectivo";
    MetodoPago["YAPE"] = "yape";
    MetodoPago["PLIN"] = "plin";
    MetodoPago["TRANSFERENCIA_BANCARIA"] = "transferencia_bancaria";
    MetodoPago["DEPOSITO_BANCARIO"] = "deposito_bancario";
    MetodoPago["MERCADOPAGO"] = "mercadopago";
    MetodoPago["TARJETA_CREDITO"] = "tarjeta_credito";
    MetodoPago["TARJETA_DEBITO"] = "tarjeta_debito";
    MetodoPago["CHEQUE"] = "cheque";
    MetodoPago["OTRO"] = "otro";
})(MetodoPago || (exports.MetodoPago = MetodoPago = {}));
var EstadoPago;
(function (EstadoPago) {
    EstadoPago["PENDIENTE_VERIFICACION"] = "pendiente_verificacion";
    EstadoPago["VERIFICADO"] = "verificado";
    EstadoPago["RECHAZADO"] = "rechazado";
    EstadoPago["DEVUELTO"] = "devuelto";
})(EstadoPago || (exports.EstadoPago = EstadoPago = {}));
let Pago = class Pago {
    get estaVerificado() {
        return this.estado === EstadoPago.VERIFICADO;
    }
    get etiquetaMetodo() {
        const etiquetas = {
            [MetodoPago.EFECTIVO]: 'Efectivo',
            [MetodoPago.YAPE]: 'Yape',
            [MetodoPago.PLIN]: 'Plin',
            [MetodoPago.TRANSFERENCIA_BANCARIA]: 'Transferencia',
            [MetodoPago.DEPOSITO_BANCARIO]: 'Depósito',
            [MetodoPago.MERCADOPAGO]: 'MercadoPago',
            [MetodoPago.TARJETA_CREDITO]: 'Tarjeta Crédito',
            [MetodoPago.TARJETA_DEBITO]: 'Tarjeta Débito',
            [MetodoPago.CHEQUE]: 'Cheque',
            [MetodoPago.OTRO]: 'Otro',
        };
        return etiquetas[this.metodoPago] || this.metodoPago;
    }
};
exports.Pago = Pago;
__decorate([
    (0, typeorm_1.Column)({ primary: true, generated: 'uuid' }),
    __metadata("design:type", String)
], Pago.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Pago.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cliente_id' }),
    __metadata("design:type", String)
], Pago.prototype, "clienteId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'factura_id', nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "facturaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'contrato_id', nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "contratoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 12, scale: 2 }),
    __metadata("design:type", Number)
], Pago.prototype, "monto", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, default: 'PEN' }),
    __metadata("design:type", String)
], Pago.prototype, "moneda", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'metodo_pago',
        type: 'enum',
        enum: MetodoPago,
    }),
    __metadata("design:type", String)
], Pago.prototype, "metodoPago", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "banco", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'numero_operacion', length: 100, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "numeroOperacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'numero_cuenta', length: 50, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "numeroCuenta", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: EstadoPago,
        default: EstadoPago.PENDIENTE_VERIFICACION,
    }),
    __metadata("design:type", String)
], Pago.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'verificado_por', nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "verificadoPor", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'verificado_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Pago.prototype, "verificadoEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'motivo_rechazo', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "motivoRechazo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'comprobante_url', length: 500, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "comprobanteUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'mp_payment_id', length: 100, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "mpPaymentId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'mp_status', length: 50, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "mpStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'mp_preference_id', length: 100, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "mpPreferenceId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'mp_detail', type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], Pago.prototype, "mpDetail", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_pago', type: 'date', default: () => 'CURRENT_DATE' }),
    __metadata("design:type", String)
], Pago.prototype, "fechaPago", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'registrado_en', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], Pago.prototype, "registradoEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cajero_id', nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "cajeroId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "notas", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], Pago.prototype, "conciliado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'conciliado_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Pago.prototype, "conciliadoEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'conciliado_por', nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "conciliadoPor", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'extracto_banco_ref', length: 200, nullable: true }),
    __metadata("design:type", String)
], Pago.prototype, "extractoBancoRef", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], Pago.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], Pago.prototype, "updatedAt", void 0);
exports.Pago = Pago = __decorate([
    (0, typeorm_1.Entity)('pagos'),
    (0, typeorm_1.Index)(['empresaId', 'fechaPago']),
    (0, typeorm_1.Index)(['empresaId', 'estado']),
    (0, typeorm_1.Index)(['clienteId', 'fechaPago']),
    (0, typeorm_1.Index)(['facturaId']),
    (0, typeorm_1.Index)(['empresaId', 'metodoPago', 'numeroOperacion'], { unique: true, where: 'numero_operacion IS NOT NULL' })
], Pago);
let CuentaBancaria = class CuentaBancaria {
};
exports.CuentaBancaria = CuentaBancaria;
__decorate([
    (0, typeorm_1.Column)({ primary: true, generated: 'uuid' }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "banco", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tipo_cuenta', length: 50, default: 'corriente' }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "tipoCuenta", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'numero_cuenta', length: 50 }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "numeroCuenta", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 50, nullable: true }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "cci", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, default: 'PEN' }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "moneda", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 200, nullable: true }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "titular", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], CuentaBancaria.prototype, "activa", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'es_principal', default: false }),
    __metadata("design:type", Boolean)
], CuentaBancaria.prototype, "esPrincipal", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'logo_banco', length: 200, nullable: true }),
    __metadata("design:type", String)
], CuentaBancaria.prototype, "logoBanco", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], CuentaBancaria.prototype, "createdAt", void 0);
exports.CuentaBancaria = CuentaBancaria = __decorate([
    (0, typeorm_1.Entity)('cuentas_bancarias'),
    (0, typeorm_1.Index)(['empresaId', 'activa'])
], CuentaBancaria);
//# sourceMappingURL=pago.entity.js.map