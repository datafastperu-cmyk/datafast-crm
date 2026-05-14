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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const bcrypt = require("bcryptjs");
const cache_manager_1 = require("@nestjs/cache-manager");
const common_2 = require("@nestjs/common");
const usuario_entity_1 = require("../usuarios/entities/usuario.entity");
const auditoria_service_1 = require("./auditoria.service");
const MAX_INTENTOS_FALLIDOS = 5;
const MINUTOS_BLOQUEO = 30;
let AuthService = AuthService_1 = class AuthService {
    constructor(usuarioRepo, jwtService, config, auditoria, cache) {
        this.usuarioRepo = usuarioRepo;
        this.jwtService = jwtService;
        this.config = config;
        this.auditoria = auditoria;
        this.cache = cache;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    async login(dto, req) {
        const { email, password, deviceInfo } = dto;
        const usuario = await this.usuarioRepo.findOne({
            where: { email: email.toLowerCase() },
            relations: ['roles', 'roles.permisos'],
        });
        if (!usuario) {
            await this.auditoria.logLogin({
                usuarioEmail: email,
                descripcion: `Intento de login con email no registrado: ${email}`,
                exitoso: false,
                req,
            });
            throw new common_1.UnauthorizedException('Email o contraseña incorrectos');
        }
        if (usuario.estado === usuario_entity_1.EstadoUsuario.INACTIVO) {
            throw new common_1.ForbiddenException('Cuenta desactivada — contacta al administrador');
        }
        if (usuario.estado === usuario_entity_1.EstadoUsuario.PENDIENTE_VERIFICACION) {
            throw new common_1.ForbiddenException('Debes verificar tu email antes de iniciar sesión');
        }
        if (usuario.estaBloqueado) {
            const hasta = usuario.bloqueadoHasta
                ? `hasta ${usuario.bloqueadoHasta.toLocaleString('es-PE', { timeZone: 'America/Lima' })}`
                : 'temporalmente';
            throw new common_1.ForbiddenException(`Cuenta bloqueada ${hasta} por múltiples intentos fallidos`);
        }
        const passwordValido = await bcrypt.compare(password, usuario.passwordHash);
        if (!passwordValido) {
            await this.handleIntentoFallido(usuario, req, email);
        }
        if (usuario.intentosFallidos > 0) {
            await this.usuarioRepo.update(usuario.id, {
                intentosFallidos: 0,
                bloqueadoHasta: null,
            });
        }
        const { accessToken, refreshToken, expiresIn } = await this.generarTokens(usuario);
        const refreshHash = await bcrypt.hash(refreshToken, 10);
        await this.usuarioRepo.update(usuario.id, {
            refreshTokenHash: refreshHash,
            ultimoAcceso: new Date(),
        });
        await this.cache.del(`user_session:${usuario.id}`);
        await this.auditoria.logLogin({
            empresaId: usuario.empresaId,
            usuarioId: usuario.id,
            usuarioEmail: usuario.email,
            descripcion: `Login exitoso${deviceInfo ? ` desde ${deviceInfo}` : ''}`,
            exitoso: true,
            req,
        });
        this.logger.log(`Login: ${usuario.email} | empresa: ${usuario.empresaId} | ip: ${req.ip}`);
        return this.buildAuthResponse(usuario, accessToken, refreshToken, expiresIn);
    }
    async refresh(usuario, req) {
        const { accessToken, refreshToken, expiresIn } = await this.generarTokens(usuario);
        const refreshHash = await bcrypt.hash(refreshToken, 10);
        await this.usuarioRepo.update(usuario.id, {
            refreshTokenHash: refreshHash,
            ultimoAcceso: new Date(),
        });
        await this.cache.del(`user_session:${usuario.id}`);
        this.logger.debug(`Token renovado: ${usuario.email}`);
        const usuarioCompleto = await this.usuarioRepo.findOne({
            where: { id: usuario.id },
            relations: ['roles', 'roles.permisos'],
        });
        return this.buildAuthResponse(usuarioCompleto, accessToken, refreshToken, expiresIn);
    }
    async logout(usuario, token, req) {
        await this.usuarioRepo.update(usuario.sub, { refreshTokenHash: null });
        const payload = this.jwtService.decode(token);
        if (payload?.exp) {
            const ttlMs = (payload.exp * 1000) - Date.now();
            if (ttlMs > 0) {
                await this.cache.set(`jwt_bl:${token.substring(0, 32)}`, true, ttlMs);
            }
        }
        await this.cache.del(`user_session:${usuario.sub}`);
        await this.auditoria.logLogout({
            empresaId: usuario.empresaId,
            usuarioId: usuario.sub,
            usuarioEmail: usuario.email,
            descripcion: 'Logout exitoso',
            req,
        });
        this.logger.log(`Logout: ${usuario.email}`);
    }
    async cambiarPassword(usuarioId, empresaId, dto, req) {
        if (dto.passwordNuevo !== dto.confirmarPassword) {
            throw new common_1.BadRequestException('Las contraseñas no coinciden');
        }
        const usuario = await this.usuarioRepo.findOne({
            where: { id: usuarioId, empresaId },
        });
        if (!usuario)
            throw new common_1.NotFoundException('Usuario no encontrado');
        const actual = await bcrypt.compare(dto.passwordActual, usuario.passwordHash);
        if (!actual) {
            throw new common_1.UnauthorizedException('La contraseña actual es incorrecta');
        }
        if (dto.passwordActual === dto.passwordNuevo) {
            throw new common_1.BadRequestException('La nueva contraseña debe ser diferente a la actual');
        }
        const nuevoHash = await bcrypt.hash(dto.passwordNuevo, 12);
        await this.usuarioRepo.update(usuarioId, {
            passwordHash: nuevoHash,
            refreshTokenHash: null,
        });
        await this.cache.del(`user_session:${usuarioId}`);
        await this.auditoria.log({
            empresaId,
            usuarioId,
            usuarioEmail: usuario.email,
            accion: 'CHANGE_PASSWORD',
            modulo: 'auth',
            descripcion: 'Cambio de contraseña exitoso',
            req,
        });
    }
    async getMe(usuarioId, empresaId) {
        const usuario = await this.usuarioRepo.findOne({
            where: { id: usuarioId, empresaId },
            relations: ['roles', 'roles.permisos'],
        });
        if (!usuario)
            throw new common_1.NotFoundException('Usuario no encontrado');
        return usuario;
    }
    async generarTokens(usuario) {
        const jwtSecret = this.config.get('jwt.secret');
        const jwtRefreshSecret = this.config.get('jwt.refreshSecret');
        const expiresIn = this.config.get('jwt.expiresIn', '15m');
        const refreshExpiresIn = this.config.get('jwt.refreshExpiresIn', '7d');
        const payload = {
            sub: usuario.id,
            email: usuario.email,
            empresaId: usuario.empresaId,
            nombreCompleto: usuario.nombreCompleto,
            roles: usuario.nombresRoles,
            permisos: usuario.permisos,
            tema: usuario.tema,
        };
        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: jwtSecret,
                expiresIn,
                issuer: 'fibranet-isp',
                audience: 'fibranet-app',
            }),
            this.jwtService.signAsync({ sub: usuario.id }, {
                secret: jwtRefreshSecret,
                expiresIn: refreshExpiresIn,
                issuer: 'fibranet-isp',
                audience: 'fibranet-app',
            }),
        ]);
        const expiresInSeconds = this.parseDuration(expiresIn);
        return { accessToken, refreshToken, expiresIn: expiresInSeconds };
    }
    buildAuthResponse(usuario, accessToken, refreshToken, expiresIn) {
        return {
            accessToken,
            refreshToken,
            expiresIn,
            tokenType: 'Bearer',
            usuario: {
                id: usuario.id,
                nombreCompleto: usuario.nombreCompleto,
                email: usuario.email,
                fotoUrl: usuario.fotoUrl,
                empresaId: usuario.empresaId,
                roles: usuario.nombresRoles,
                permisos: usuario.permisos,
                tema: usuario.tema,
            },
        };
    }
    async handleIntentoFallido(usuario, req, email) {
        const nuevosIntentos = usuario.intentosFallidos + 1;
        const updates = { intentosFallidos: nuevosIntentos };
        if (nuevosIntentos >= MAX_INTENTOS_FALLIDOS) {
            const bloqueadoHasta = new Date(Date.now() + MINUTOS_BLOQUEO * 60 * 1000);
            updates.bloqueadoHasta = bloqueadoHasta;
            updates.estado = usuario_entity_1.EstadoUsuario.BLOQUEADO;
            this.logger.warn(`Cuenta bloqueada: ${email} tras ${nuevosIntentos} intentos fallidos | ip: ${req.ip}`);
        }
        await this.usuarioRepo.update(usuario.id, updates);
        await this.auditoria.logLogin({
            empresaId: usuario.empresaId,
            usuarioId: usuario.id,
            usuarioEmail: email,
            descripcion: `Intento fallido ${nuevosIntentos}/${MAX_INTENTOS_FALLIDOS}`,
            exitoso: false,
            req,
        });
        const restantes = MAX_INTENTOS_FALLIDOS - nuevosIntentos;
        const mensaje = restantes > 0
            ? `Email o contraseña incorrectos. ${restantes} intento(s) restante(s)`
            : `Cuenta bloqueada por ${MINUTOS_BLOQUEO} minutos por múltiples intentos fallidos`;
        throw new common_1.UnauthorizedException(mensaje);
    }
    parseDuration(duration) {
        const match = duration.match(/^(\d+)([smhd])$/);
        if (!match)
            return 900;
        const value = parseInt(match[1]);
        const unit = match[2];
        const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
        return value * (multipliers[unit] || 60);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(usuario_entity_1.Usuario)),
    __param(4, (0, common_2.Inject)(cache_manager_1.CACHE_MANAGER)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        jwt_1.JwtService,
        config_1.ConfigService,
        auditoria_service_1.AuditoriaService, Object])
], AuthService);
//# sourceMappingURL=auth.service.js.map