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
exports.Rol = void 0;
const typeorm_1 = require("typeorm");
const swagger_1 = require("@nestjs/swagger");
const base_entity_1 = require("../../../common/entities/base.entity");
const permiso_entity_1 = require("./permiso.entity");
const usuario_entity_1 = require("./usuario.entity");
let Rol = class Rol extends base_entity_1.BaseModel {
    get codigosPermisos() {
        return this.permisos?.map((p) => p.codigo) ?? [];
    }
};
exports.Rol = Rol;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Rol.prototype, "empresaId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Cajero' }),
    (0, typeorm_1.Column)({ length: 80 }),
    __metadata("design:type", String)
], Rol.prototype, "nombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Rol.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'es_sistema', default: false }),
    __metadata("design:type", Boolean)
], Rol.prototype, "esSistema", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => permiso_entity_1.Permiso, (permiso) => permiso.roles, { eager: true }),
    (0, typeorm_1.JoinTable)({
        name: 'roles_permisos',
        joinColumn: { name: 'rol_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'permiso_id', referencedColumnName: 'id' },
    }),
    __metadata("design:type", Array)
], Rol.prototype, "permisos", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => usuario_entity_1.Usuario, (u) => u.roles),
    __metadata("design:type", Array)
], Rol.prototype, "usuarios", void 0);
exports.Rol = Rol = __decorate([
    (0, typeorm_1.Entity)('roles')
], Rol);
//# sourceMappingURL=rol.entity.js.map