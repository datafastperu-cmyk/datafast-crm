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
exports.BaseModel = void 0;
const typeorm_1 = require("typeorm");
const swagger_1 = require("@nestjs/swagger");
class BaseModel extends typeorm_1.BaseEntity {
}
exports.BaseModel = BaseModel;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'ID único UUID' }),
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], BaseModel.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Fecha de creación' }),
    (0, typeorm_1.CreateDateColumn)({
        type: 'timestamptz',
        name: 'created_at',
        comment: 'Fecha y hora de creación (con timezone)',
    }),
    __metadata("design:type", Date)
], BaseModel.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Fecha de última actualización' }),
    (0, typeorm_1.UpdateDateColumn)({
        type: 'timestamptz',
        name: 'updated_at',
        comment: 'Fecha y hora de última modificación',
    }),
    __metadata("design:type", Date)
], BaseModel.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.DeleteDateColumn)({
        type: 'timestamptz',
        name: 'deleted_at',
        nullable: true,
        comment: 'Soft delete — null = activo',
    }),
    __metadata("design:type", Date)
], BaseModel.prototype, "deletedAt", void 0);
//# sourceMappingURL=base.entity.js.map