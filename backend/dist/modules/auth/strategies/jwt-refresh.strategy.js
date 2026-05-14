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
exports.JwtRefreshStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const bcrypt = require("bcryptjs");
const usuario_entity_1 = require("../../usuarios/entities/usuario.entity");
let JwtRefreshStrategy = class JwtRefreshStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy, 'jwt-refresh') {
    constructor(config, usuarioRepo) {
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromBodyField('refreshToken'),
            ignoreExpiration: false,
            secretOrKey: config.get('jwt.refreshSecret'),
            passReqToCallback: true,
            issuer: 'fibranet-isp',
            audience: 'fibranet-app',
        });
        this.config = config;
        this.usuarioRepo = usuarioRepo;
    }
    async validate(req, payload) {
        const { sub: userId } = payload;
        const refreshToken = req.body?.refreshToken;
        if (!refreshToken) {
            throw new common_1.UnauthorizedException('Refresh token no proporcionado');
        }
        const usuario = await this.usuarioRepo.findOne({
            where: { id: userId },
            relations: ['roles', 'roles.permisos'],
        });
        if (!usuario || !usuario.refreshTokenHash) {
            throw new common_1.UnauthorizedException('Sesión inválida — inicia sesión nuevamente');
        }
        if (usuario.estado !== usuario_entity_1.EstadoUsuario.ACTIVO) {
            throw new common_1.UnauthorizedException('Cuenta inactiva');
        }
        const tokenValido = await bcrypt.compare(refreshToken, usuario.refreshTokenHash);
        if (!tokenValido) {
            await this.usuarioRepo.update(userId, { refreshTokenHash: null });
            throw new common_1.UnauthorizedException('Refresh token inválido — sesión cerrada por seguridad');
        }
        return usuario;
    }
};
exports.JwtRefreshStrategy = JwtRefreshStrategy;
exports.JwtRefreshStrategy = JwtRefreshStrategy = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(usuario_entity_1.Usuario)),
    __metadata("design:paramtypes", [config_1.ConfigService,
        typeorm_2.Repository])
], JwtRefreshStrategy);
//# sourceMappingURL=jwt-refresh.strategy.js.map