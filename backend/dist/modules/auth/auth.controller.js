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
var AuthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const throttler_1 = require("@nestjs/throttler");
const auth_service_1 = require("./auth.service");
const auditoria_service_1 = require("./auditoria.service");
const auth_dto_1 = require("./dto/auth.dto");
const jwt_refresh_guard_1 = require("./guards/jwt-refresh.guard");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const passport_jwt_1 = require("passport-jwt");
let AuthController = AuthController_1 = class AuthController {
    constructor(authService, auditoria) {
        this.authService = authService;
        this.auditoria = auditoria;
        this.logger = new common_1.Logger(AuthController_1.name);
    }
    async login(dto, req) {
        return this.authService.login(dto, req);
    }
    async refresh(req) {
        return this.authService.refresh(req.user, req);
    }
    async logout(user, req) {
        const token = passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken()(req) || '';
        return this.authService.logout(user, token, req);
    }
    async me(user) {
        return this.authService.getMe(user.sub, user.empresaId);
    }
    async changePassword(user, dto, req) {
        return this.authService.cambiarPassword(user.sub, user.empresaId, dto, req);
    }
    async getPermissions(user) {
        return {
            roles: user.roles,
            permisos: user.permisos,
            esAdmin: user.roles?.includes('Administrador') ?? false,
        };
    }
    async getAudit(user) {
        return this.auditoria.getHistorialUsuario(user.sub, user.empresaId);
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({
        summary: 'Iniciar sesión',
        description: 'Retorna access token (15min) y refresh token (7 días). ' +
            'La cuenta se bloquea por 30 min tras 5 intentos fallidos.',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, type: auth_dto_1.AuthResponseDto, description: 'Login exitoso' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'Credenciales inválidas' }),
    (0, swagger_1.ApiResponse)({ status: 403, description: 'Cuenta bloqueada o inactiva' }),
    (0, swagger_1.ApiResponse)({ status: 429, description: 'Demasiados intentos — espera 1 minuto' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_dto_1.LoginDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.UseGuards)(jwt_refresh_guard_1.JwtRefreshGuard),
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({
        summary: 'Renovar access token',
        description: 'Usa el refresh token para obtener un nuevo access token. ' +
            'Implementa rotación de tokens: el refresh token anterior queda inválido.',
    }),
    (0, swagger_1.ApiBody)({ type: auth_dto_1.RefreshTokenDto }),
    (0, swagger_1.ApiResponse)({ status: 200, type: auth_dto_1.AuthResponseDto }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'Refresh token inválido o expirado' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, swagger_1.ApiOperation)({
        summary: 'Cerrar sesión',
        description: 'Invalida el access token actual y elimina el refresh token. ' +
            'El token queda en blacklist hasta su expiración natural.',
    }),
    (0, swagger_1.ApiResponse)({ status: 204, description: 'Sesión cerrada correctamente' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, swagger_1.ApiOperation)({
        summary: 'Perfil del usuario autenticado',
        description: 'Retorna datos del usuario actual con sus roles y permisos.',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Datos del usuario actual' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)('change-password'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, swagger_1.ApiOperation)({
        summary: 'Cambiar contraseña',
        description: 'Requiere la contraseña actual. Al cambiar, cierra todas las sesiones activas.',
    }),
    (0, swagger_1.ApiResponse)({ status: 204, description: 'Contraseña cambiada — todas las sesiones cerradas' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Las contraseñas no coinciden o igual a la anterior' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'Contraseña actual incorrecta' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, auth_dto_1.ChangePasswordDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "changePassword", null);
__decorate([
    (0, common_1.Get)('permissions'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, swagger_1.ApiOperation)({
        summary: 'Permisos del usuario actual',
        description: 'Lista todos los permisos del usuario para que el frontend los cachee.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getPermissions", null);
__decorate([
    (0, common_1.Get)('audit'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, swagger_1.ApiOperation)({
        summary: 'Historial de accesos del usuario actual',
        description: 'Últimos 50 accesos del usuario autenticado.',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getAudit", null);
exports.AuthController = AuthController = AuthController_1 = __decorate([
    (0, swagger_1.ApiTags)('Auth'),
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        auditoria_service_1.AuditoriaService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map