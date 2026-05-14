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
var AuditoriaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditoriaService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const auditoria_log_entity_1 = require("../usuarios/entities/auditoria-log.entity");
let AuditoriaService = AuditoriaService_1 = class AuditoriaService {
    constructor(logRepo) {
        this.logRepo = logRepo;
        this.logger = new common_1.Logger(AuditoriaService_1.name);
    }
    async log(params) {
        try {
            const entry = this.logRepo.create({
                empresaId: params.empresaId,
                usuarioId: params.usuarioId,
                usuarioEmail: params.usuarioEmail,
                accion: params.accion,
                modulo: params.modulo,
                entidadId: params.entidadId,
                descripcion: params.descripcion,
                datosAnteriores: this.sanitize(params.datosAnteriores),
                datosNuevos: this.sanitize(params.datosNuevos),
                ipAddress: params.req ? this.getIp(params.req) : undefined,
                userAgent: params.req?.get('user-agent')?.substring(0, 300),
                metodoHttp: params.req?.method,
                ruta: params.req?.path,
            });
            this.logRepo.save(entry).catch((err) => this.logger.error(`Error guardando log de auditoría: ${err.message}`));
        }
        catch (err) {
            this.logger.error(`AuditoriaService.log failed: ${err.message}`);
        }
    }
    async logLogin(params) {
        return this.log({
            ...params,
            accion: params.exitoso ? 'LOGIN' : 'LOGIN_FAIL',
            modulo: 'auth',
        });
    }
    async logLogout(params) {
        return this.log({ ...params, accion: 'LOGOUT', modulo: 'auth' });
    }
    async logCreate(params) {
        return this.log({ ...params, accion: 'CREATE' });
    }
    async logUpdate(params) {
        return this.log({ ...params, accion: 'UPDATE' });
    }
    async logDelete(params) {
        return this.log({ ...params, accion: 'DELETE' });
    }
    getIp(req) {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded)
            return forwarded.split(',')[0].trim();
        return req.ip || req.connection?.remoteAddress || 'unknown';
    }
    sanitize(data) {
        if (!data)
            return undefined;
        const sensitiveFields = [
            'password', 'passwordHash', 'password_hash',
            'refreshToken', 'refreshTokenHash', 'refresh_token_hash',
            'token', 'secret', 'clave', 'claveSecreta',
            'passwordCifrado', 'password_cifrado',
            'creditCard', 'cvv', 'pin',
        ];
        const sanitized = { ...data };
        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }
        return sanitized;
    }
    async getHistorialUsuario(usuarioId, empresaId, limit = 50) {
        return this.logRepo.find({
            where: { usuarioId, empresaId },
            order: { createdAt: 'DESC' },
            take: limit,
        });
    }
    async getHistorialEntidad(entidadId, empresaId) {
        return this.logRepo.find({
            where: { entidadId, empresaId },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }
};
exports.AuditoriaService = AuditoriaService;
exports.AuditoriaService = AuditoriaService = AuditoriaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(auditoria_log_entity_1.AuditoriaLog)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], AuditoriaService);
//# sourceMappingURL=auditoria.service.js.map