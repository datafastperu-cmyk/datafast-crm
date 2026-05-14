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
exports.Permiso = void 0;
const typeorm_1 = require("typeorm");
const swagger_1 = require("@nestjs/swagger");
const rol_entity_1 = require("./rol.entity");
let Permiso = class Permiso {
};
exports.Permiso = Permiso;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Permiso.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'clientes:create' }),
    (0, typeorm_1.Column)({ unique: true, length: 80 }),
    __metadata("design:type", String)
], Permiso.prototype, "codigo", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 150 }),
    __metadata("design:type", String)
], Permiso.prototype, "nombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Permiso.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 60 }),
    __metadata("design:type", String)
], Permiso.prototype, "modulo", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at', type: 'timestamptz' }),
    __metadata("design:type", Date)
], Permiso.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => rol_entity_1.Rol, (rol) => rol.permisos),
    __metadata("design:type", Array)
], Permiso.prototype, "roles", void 0);
exports.Permiso = Permiso = __decorate([
    (0, typeorm_1.Entity)('permisos')
], Permiso);
//# sourceMappingURL=permiso.entity.js.map