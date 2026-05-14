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
var RolesGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RolesGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const roles_decorator_1 = require("../decorators/roles.decorator");
let RolesGuard = RolesGuard_1 = class RolesGuard {
    constructor(reflector) {
        this.reflector = reflector;
        this.logger = new common_1.Logger(RolesGuard_1.name);
    }
    canActivate(context) {
        const requiredRoles = this.reflector.getAllAndOverride(roles_decorator_1.ROLES_KEY, [context.getHandler(), context.getClass()]);
        const requiredPermissions = this.reflector.getAllAndOverride(roles_decorator_1.PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
        if (!requiredRoles?.length && !requiredPermissions?.length) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user) {
            throw new common_1.ForbiddenException('Usuario no autenticado');
        }
        const userRoles = user.roles || [];
        const userPermissions = user.permisos || [];
        if (userRoles.includes('admin')) {
            return true;
        }
        if (requiredRoles?.length) {
            const hasRole = requiredRoles.some((role) => userRoles.includes(role));
            if (!hasRole) {
                this.logger.warn(`Acceso denegado: usuario ${user.sub} con roles [${userRoles}] intentó acceder a ruta que requiere [${requiredRoles}]`);
                throw new common_1.ForbiddenException(`Acceso denegado — se requiere uno de estos roles: ${requiredRoles.join(', ')}`);
            }
        }
        if (requiredPermissions?.length) {
            const hasPermission = requiredPermissions.every((perm) => userPermissions.includes(perm));
            if (!hasPermission) {
                this.logger.warn(`Acceso denegado: usuario ${user.sub} sin permisos [${requiredPermissions}]`);
                throw new common_1.ForbiddenException(`Acceso denegado — sin permiso para realizar esta acción`);
            }
        }
        return true;
    }
};
exports.RolesGuard = RolesGuard;
exports.RolesGuard = RolesGuard = RolesGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector])
], RolesGuard);
//# sourceMappingURL=roles.guard.js.map