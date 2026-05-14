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
exports.ClienteHistorialEstado = exports.Cliente = exports.TipoServicio = exports.TipoDocumento = exports.EstadoCliente = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
var EstadoCliente;
(function (EstadoCliente) {
    EstadoCliente["ACTIVO"] = "activo";
    EstadoCliente["SUSPENDIDO"] = "suspendido";
    EstadoCliente["MOROSO"] = "moroso";
    EstadoCliente["BAJA_TEMPORAL"] = "baja_temporal";
    EstadoCliente["BAJA_DEFINITIVA"] = "baja_definitiva";
    EstadoCliente["PROSPECTO"] = "prospecto";
})(EstadoCliente || (exports.EstadoCliente = EstadoCliente = {}));
var TipoDocumento;
(function (TipoDocumento) {
    TipoDocumento["DNI"] = "dni";
    TipoDocumento["RUC"] = "ruc";
    TipoDocumento["CE"] = "ce";
    TipoDocumento["PASAPORTE"] = "pasaporte";
})(TipoDocumento || (exports.TipoDocumento = TipoDocumento = {}));
var TipoServicio;
(function (TipoServicio) {
    TipoServicio["FTTH"] = "ftth";
    TipoServicio["WISP"] = "wisp";
    TipoServicio["DEDICADO"] = "dedicado";
    TipoServicio["MIXTO"] = "mixto";
})(TipoServicio || (exports.TipoServicio = TipoServicio = {}));
let Cliente = class Cliente extends base_entity_1.BaseModel {
};
exports.Cliente = Cliente;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Cliente.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tipo_documento', type: 'enum', enum: TipoDocumento, default: TipoDocumento.DNI }),
    __metadata("design:type", String)
], Cliente.prototype, "tipoDocumento", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'numero_documento', length: 20 }),
    __metadata("design:type", String)
], Cliente.prototype, "numeroDocumento", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Cliente.prototype, "nombres", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'apellido_paterno', length: 80 }),
    __metadata("design:type", String)
], Cliente.prototype, "apellidoPaterno", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'apellido_materno', length: 80, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "apellidoMaterno", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nombre_completo', insert: false, update: false, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "nombreCompleto", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 150, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 20 }),
    __metadata("design:type", String)
], Cliente.prototype, "telefono", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'telefono_alt', length: 20, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "telefonoAlt", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 20, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "whatsapp", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], Cliente.prototype, "direccion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "referencia", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "departamento", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "provincia", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "distrito", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "ubigeo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Cliente.prototype, "latitud", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Cliente.prototype, "longitud", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'precision_gps', type: 'decimal', precision: 8, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Cliente.prototype, "precisionGps", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'foto_url', length: 500, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "fotoUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'foto_instalacion_url', length: 500, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "fotoInstalacionUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: EstadoCliente, default: EstadoCliente.PROSPECTO }),
    __metadata("design:type", String)
], Cliente.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'fecha_estado', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], Cliente.prototype, "fechaEstado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'motivo_estado', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "motivoEstado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tipo_servicio', type: 'enum', enum: TipoServicio, nullable: true, default: TipoServicio.FTTH }),
    __metadata("design:type", String)
], Cliente.prototype, "tipoServicio", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'codigo_cliente', length: 30, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "codigoCliente", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notas_internas', type: 'text', nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "notasInternas", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'etiquetas', type: 'text', array: true, nullable: true }),
    __metadata("design:type", Array)
], Cliente.prototype, "etiquetas", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'es_empresa', default: false }),
    __metadata("design:type", Boolean)
], Cliente.prototype, "esEmpresa", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ruc_empresa', length: 20, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "rucEmpresa", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'razon_social', length: 200, nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "razonSocial", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'referido_por', nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "referidoPorId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'vendedor_id', nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "vendedorId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reniec_consultado', default: false }),
    __metadata("design:type", Boolean)
], Cliente.prototype, "reniecConsultado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reniec_consultado_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Cliente.prototype, "reniecConsultadoEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reniec_datos_raw', type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], Cliente.prototype, "reniecDatosRaw", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_by', nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'updated_by', nullable: true }),
    __metadata("design:type", String)
], Cliente.prototype, "updatedBy", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => ClienteHistorialEstado, (h) => h.cliente),
    __metadata("design:type", Array)
], Cliente.prototype, "historialEstados", void 0);
exports.Cliente = Cliente = __decorate([
    (0, typeorm_1.Entity)('clientes'),
    (0, typeorm_1.Index)(['empresaId', 'estado']),
    (0, typeorm_1.Index)(['empresaId', 'tipoDocumento', 'numeroDocumento'])
], Cliente);
let ClienteHistorialEstado = class ClienteHistorialEstado {
};
exports.ClienteHistorialEstado = ClienteHistorialEstado;
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', primary: true, generated: 'increment' }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cliente_id' }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "clienteId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'estado_anterior', type: 'enum', enum: EstadoCliente, nullable: true }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "estadoAnterior", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'estado_nuevo', type: 'enum', enum: EstadoCliente }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "estadoNuevo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "motivo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'usuario_id', nullable: true }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "usuarioId", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], ClienteHistorialEstado.prototype, "automatico", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], ClienteHistorialEstado.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => Cliente, (c) => c.historialEstados),
    (0, typeorm_1.JoinColumn)({ name: 'cliente_id' }),
    __metadata("design:type", Cliente)
], ClienteHistorialEstado.prototype, "cliente", void 0);
exports.ClienteHistorialEstado = ClienteHistorialEstado = __decorate([
    (0, typeorm_1.Entity)('clientes_historial_estados'),
    (0, typeorm_1.Index)(['clienteId', 'createdAt'])
], ClienteHistorialEstado);
//# sourceMappingURL=cliente.entity.js.map