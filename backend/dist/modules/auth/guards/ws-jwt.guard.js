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
var WsJwtGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WsJwtGuard = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const websockets_1 = require("@nestjs/websockets");
const cache_manager_1 = require("@nestjs/cache-manager");
const common_2 = require("@nestjs/common");
let WsJwtGuard = WsJwtGuard_1 = class WsJwtGuard {
    constructor(jwtService, config, cache) {
        this.jwtService = jwtService;
        this.config = config;
        this.cache = cache;
        this.logger = new common_1.Logger(WsJwtGuard_1.name);
    }
    async canActivate(context) {
        const client = context.switchToWs().getClient();
        try {
            const token = this.extractToken(client);
            if (!token)
                throw new websockets_1.WsException('Token no proporcionado');
            const blacklistKey = `jwt_bl:${token.substring(0, 32)}`;
            if (await this.cache.get(blacklistKey)) {
                throw new websockets_1.WsException('Token invalidado');
            }
            const payload = this.jwtService.verify(token, {
                secret: this.config.get('jwt.secret'),
                issuer: 'fibranet-isp',
                audience: 'fibranet-app',
            });
            client.user = payload;
            client.join(`empresa:${payload.empresaId}`);
            return true;
        }
        catch (err) {
            this.logger.warn(`WS auth failed: ${err.message} | socket: ${client.id}`);
            client.emit('error', { message: 'No autorizado', code: 'WS_UNAUTHORIZED' });
            client.disconnect(true);
            return false;
        }
    }
    extractToken(client) {
        const authToken = client.handshake?.auth?.token;
        if (authToken)
            return authToken.replace(/^Bearer\s+/i, '');
        const header = client.handshake?.headers?.authorization;
        if (header)
            return header.replace(/^Bearer\s+/i, '');
        const query = client.handshake?.query?.token;
        if (query)
            return query;
        return null;
    }
};
exports.WsJwtGuard = WsJwtGuard;
exports.WsJwtGuard = WsJwtGuard = WsJwtGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_2.Inject)(cache_manager_1.CACHE_MANAGER)),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        config_1.ConfigService, Object])
], WsJwtGuard);
//# sourceMappingURL=ws-jwt.guard.js.map