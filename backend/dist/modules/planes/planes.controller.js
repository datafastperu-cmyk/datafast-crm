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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const planes_service_1 = require("./planes.service");
const plan_dto_1 = require("./dto/plan.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let PlanesController = class PlanesController {
    constructor(svc) {
        this.svc = svc;
    }
    async create(dto, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.create(dto, user), 'Plan creado');
    }
    async findAll(filters, user) {
        const r = await this.svc.findAll(user.empresaId, filters);
        return response_dto_1.ApiResponse.ok(r.data, 'Planes obtenidos', { total: r.total });
    }
    async findOne(id, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.findOne(id, user.empresaId));
    }
    async update(id, dto, user) {
        return response_dto_1.ApiResponse.ok(await this.svc.update(id, dto, user), 'Plan actualizado');
    }
    async remove(id, user) {
        await this.svc.remove(id, user);
    }
};
exports.PlanesController = PlanesController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.RequirePermission)('planes:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Crear plan de servicio' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [plan_dto_1.CreatePlanDto, Object]),
    __metadata("design:returntype", Promise)
], PlanesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.RequirePermission)('planes:view'),
    (0, swagger_1.ApiOperation)({ summary: 'Listar planes' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [plan_dto_1.FilterPlanDto, Object]),
    __metadata("design:returntype", Promise)
], PlanesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.RequirePermission)('planes:view'),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener plan por ID' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PlanesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, roles_decorator_1.RequirePermission)('planes:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar plan' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, plan_dto_1.UpdatePlanDto, Object]),
    __metadata("design:returntype", Promise)
], PlanesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.RequirePermission)('planes:manage'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Eliminar plan' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PlanesController.prototype, "remove", null);
exports.PlanesController = PlanesController = __decorate([
    (0, swagger_1.ApiTags)('Planes'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('planes'),
    __metadata("design:paramtypes", [planes_service_1.PlanesService])
], PlanesController);
//# sourceMappingURL=planes.controller.js.map