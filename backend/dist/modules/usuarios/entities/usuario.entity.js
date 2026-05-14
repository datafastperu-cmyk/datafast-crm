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
exports.Usuario = exports.EstadoUsuario = void 0;
const typeorm_1 = require("typeorm");
const class_transformer_1 = require("class-transformer");
const swagger_1 = require("@nestjs/swagger");
const base_entity_1 = require("../../../common/entities/base.entity");
const rol_entity_1 = require("./rol.entity");
var EstadoUsuario;
(function (EstadoUsuario) {
    EstadoUsuario["ACTIVO"] = "activo";
    EstadoUsuario["INACTIVO"] = "inactivo";
    EstadoUsuario["BLOQUEADO"] = "bloqueado";
    EstadoUsuario["PENDIENTE_VERIFICACION"] = "pendiente_verificacion";
})(EstadoUsuario || (exports.EstadoUsuario = EstadoUsuario = {}));
let Usuario = class Usuario extends base_entity_1.BaseModel {
    get nombreCompleto() {
        return `${this.nombres} ${this.apellidos}`;
    }
    get nombresRoles() {
        return this.roles?.map((r) => r.nombre) ?? [];
    }
    get permisos() {
        const set = new Set();
        this.roles?.forEach((r) => r.codigosPermisos.forEach((p) => set.add(p)));
        return [...set];
    }
    get estaActivo() {
        return this.estado === EstadoUsuario.ACTIVO && !this.deletedAt;
    }
    get estaBloqueado() {
        if (this.estado === EstadoUsuario.BLOQUEADO)
            return true;
        if (this.bloqueadoHasta && this.bloqueadoHasta > new Date())
            return true;
        return false;
    }
};
exports.Usuario = Usuario;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Usuario.prototype, "empresaId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Juan' }),
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Usuario.prototype, "nombres", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Pérez García' }),
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Usuario.prototype, "apellidos", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'juan@fibranet.pe' }),
    (0, typeorm_1.Column)({ length: 150 }),
    __metadata("design:type", String)
], Usuario.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 20, nullable: true }),
    __metadata("design:type", String)
], Usuario.prototype, "telefono", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'foto_url', length: 500, nullable: true }),
    __metadata("design:type", String)
], Usuario.prototype, "fotoUrl", void 0);
__decorate([
    (0, class_transformer_1.Exclude)(),
    (0, swagger_1.ApiHideProperty)(),
    (0, typeorm_1.Column)({ name: 'password_hash', length: 250 }),
    __metadata("design:type", String)
], Usuario.prototype, "passwordHash", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: EstadoUsuario,
        default: EstadoUsuario.ACTIVO,
    }),
    __metadata("design:type", String)
], Usuario.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'email_verificado', default: false }),
    __metadata("design:type", Boolean)
], Usuario.prototype, "emailVerificado", void 0);
__decorate([
    (0, class_transformer_1.Exclude)(),
    (0, typeorm_1.Column)({ name: 'token_verificacion', length: 200, nullable: true }),
    __metadata("design:type", String)
], Usuario.prototype, "tokenVerificacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ultimo_acceso', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Usuario.prototype, "ultimoAcceso", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'intentos_fallidos', default: 0 }),
    __metadata("design:type", Number)
], Usuario.prototype, "intentosFallidos", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'bloqueado_hasta', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Usuario.prototype, "bloqueadoHasta", void 0);
__decorate([
    (0, class_transformer_1.Exclude)(),
    (0, typeorm_1.Column)({ name: 'refresh_token_hash', length: 500, nullable: true }),
    __metadata("design:type", String)
], Usuario.prototype, "refreshTokenHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'zona_horaria', length: 50, default: 'America/Lima' }),
    __metadata("design:type", String)
], Usuario.prototype, "zonaHoraria", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, default: 'es' }),
    __metadata("design:type", String)
], Usuario.prototype, "idioma", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 20, default: 'dark' }),
    __metadata("design:type", String)
], Usuario.prototype, "tema", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => rol_entity_1.Rol, (rol) => rol.usuarios, { eager: true }),
    (0, typeorm_1.JoinTable)({
        name: 'usuarios_roles',
        joinColumn: { name: 'usuario_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'rol_id', referencedColumnName: 'id' },
    }),
    __metadata("design:type", Array)
], Usuario.prototype, "roles", void 0);
exports.Usuario = Usuario = __decorate([
    (0, typeorm_1.Entity)('usuarios')
], Usuario);
//# sourceMappingURL=usuario.entity.js.map