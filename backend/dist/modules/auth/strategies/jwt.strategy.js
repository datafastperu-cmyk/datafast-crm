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
exports.JwtStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const cache_manager_1 = require("@nestjs/cache-manager");
const common_2 = require("@nestjs/common");
const usuario_entity_1 = require("../../usuarios/entities/usuario.entity");
let JwtStrategy = class JwtStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy, 'jwt') {
    constructor(config, usuarioRepo, cache) {
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: config.get('jwt.secret'),
            passReqToCallback: true,
            issuer: 'fibranet-isp',
            audience: 'fibranet-app',
        });
        this.config = config;
        this.usuarioRepo = usuarioRepo;
        this.cache = cache;
    }
    async validate(req, payload) {
        const { sub: userId, empresaId } = payload;
        const token = passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken()(req);
        const blacklistKey = `jwt_bl:${token?.substring(0, 32)}`;
        const isBlacklisted = await this.cache.get(blacklistKey);
        if (isBlacklisted) {
            throw new common_1.UnauthorizedException('Token invalidado — inicia sesión nuevamente');
        }
        const cacheKey = `user_session:${userId}`;
        const cached = await this.cache.get(cacheKey);
        if (cached)
            return cached;
        const usuario = await this.usuarioRepo.findOne({
            where: { id: userId, empresaId },
            relations: ['roles', 'roles.permisos'],
        });
        if (!usuario) {
            throw new common_1.UnauthorizedException('Usuario no encontrado');
        }
        if (usuario.estado !== usuario_entity_1.EstadoUsuario.ACTIVO) {
            throw new common_1.UnauthorizedException(`Cuenta ${usuario.estado} — contacta al administrador`);
        }
        if (usuario.estaBloqueado) {
            const hasta = usuario.bloqueadoHasta
                ? ` hasta ${usuario.bloqueadoHasta.toLocaleString('es-PE')}`
                : '';
            throw new common_1.UnauthorizedException(`Cuenta bloqueada${hasta}`);
        }
        const enrichedPayload = {
            sub: usuario.id,
            email: usuario.email,
            empresaId: usuario.empresaId,
            nombreCompleto: usuario.nombreCompleto,
            roles: usuario.nombresRoles,
            permisos: usuario.permisos,
            tema: usuario.tema,
        };
        await this.cache.set(cacheKey, enrichedPayload, 300_000);
        return enrichedPayload;
    }
};
exports.JwtStrategy = JwtStrategy;
exports.JwtStrategy = JwtStrategy = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(usuario_entity_1.Usuario)),
    __param(2, (0, common_2.Inject)(cache_manager_1.CACHE_MANAGER)),
    __metadata("design:paramtypes", [config_1.ConfigService,
        typeorm_2.Repository, Object])
], JwtStrategy);
//# sourceMappingURL=jwt.strategy.js.map