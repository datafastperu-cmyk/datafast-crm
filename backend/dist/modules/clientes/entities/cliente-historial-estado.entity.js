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
exports.ClienteHistorialEstado = void 0;
const typeorm_1 = require("typeorm");
const cliente_entity_1 = require("./cliente.entity");
let ClienteHistorialEstado = class ClienteHistorialEstado {
};
exports.ClienteHistorialEstado = ClienteHistorialEstado;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('increment', { type: 'bigint' }),
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
    (0, typeorm_1.Column)({
        name: 'estado_anterior',
        type: 'enum',
        enum: cliente_entity_1.EstadoCliente,
        nullable: true,
    }),
    __metadata("design:type", String)
], ClienteHistorialEstado.prototype, "estadoAnterior", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'estado_nuevo',
        type: 'enum',
        enum: cliente_entity_1.EstadoCliente,
    }),
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
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at', type: 'timestamptz' }),
    __metadata("design:type", Date)
], ClienteHistorialEstado.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => cliente_entity_1.Cliente, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'cliente_id' }),
    __metadata("design:type", cliente_entity_1.Cliente)
], ClienteHistorialEstado.prototype, "cliente", void 0);
exports.ClienteHistorialEstado = ClienteHistorialEstado = __decorate([
    (0, typeorm_1.Entity)('clientes_historial_estados'),
    (0, typeorm_1.Index)(['clienteId', 'createdAt'])
], ClienteHistorialEstado);
//# sourceMappingURL=cliente-historial-estado.entity.js.map