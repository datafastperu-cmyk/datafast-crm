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
var PppoeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PppoeService = void 0;
const common_1 = require("@nestjs/common");
const connection_pool_service_1 = require("./connection-pool.service");
let PppoeService = PppoeService_1 = class PppoeService {
    constructor(pool) {
        this.pool = pool;
        this.logger = new common_1.Logger(PppoeService_1.name);
    }
    async crear(creds, params) {
        return this.pool.execute(creds, async (api) => {
            const existing = await api.write('/ppp/secret/print', [
                `?name=${params.name}`,
            ]);
            if (existing.length > 0) {
                this.logger.warn(`PPPoE: usuario ${params.name} ya existe en ${creds.ip} — actualizando`);
                const existingId = existing[0]['.id'];
                await api.write('/ppp/secret/set', [
                    `=.id=${existingId}`,
                    `=password=${params.password}`,
                    `=profile=${params.profile}`,
                    `=service=${params.service || 'pppoe'}`,
                    ...(params.remoteAddress ? [`=remote-address=${params.remoteAddress}`] : []),
                    ...(params.comment ? [`=comment=${params.comment}`] : []),
                    `=disabled=${params.disabled ? 'yes' : 'no'}`,
                ]);
                return existingId;
            }
            const result = await api.write('/ppp/secret/add', [
                `=name=${params.name}`,
                `=password=${params.password}`,
                `=profile=${params.profile}`,
                `=service=${params.service || 'pppoe'}`,
                ...(params.remoteAddress ? [`=remote-address=${params.remoteAddress}`] : []),
                ...(params.comment ? [`=comment=${params.comment}`] : []),
                `=disabled=${params.disabled ? 'yes' : 'no'}`,
            ]);
            const id = result?.[0]?.ret || '';
            this.logger.log(`PPPoE creado: ${params.name} en ${creds.ip}`);
            return id;
        });
    }
    async eliminar(creds, name) {
        await this.pool.execute(creds, async (api) => {
            const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
            if (secrets.length === 0) {
                this.logger.warn(`PPPoE: usuario ${name} no existe en ${creds.ip}`);
                return;
            }
            await api.write('/ppp/secret/remove', [`=.id=${secrets[0]['.id']}`]);
            this.logger.log(`PPPoE eliminado: ${name} en ${creds.ip}`);
        });
    }
    async setEstado(creds, name, disabled) {
        await this.pool.execute(creds, async (api) => {
            const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
            if (secrets.length === 0)
                return;
            await api.write('/ppp/secret/set', [
                `=.id=${secrets[0]['.id']}`,
                `=disabled=${disabled ? 'yes' : 'no'}`,
            ]);
            this.logger.log(`PPPoE ${disabled ? 'deshabilitado' : 'habilitado'}: ${name} en ${creds.ip}`);
        });
    }
    async desconectarSesion(creds, name) {
        await this.pool.execute(creds, async (api) => {
            const sessions = await api.write('/ppp/active/print', [`?name=${name}`]);
            for (const session of sessions) {
                await api.write('/ppp/active/remove', [`=.id=${session['.id']}`]);
                this.logger.log(`Sesión PPPoE desconectada: ${name} en ${creds.ip}`);
            }
        });
    }
    async cambiarPassword(creds, name, newPassword) {
        await this.pool.execute(creds, async (api) => {
            const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
            if (secrets.length === 0)
                return;
            await api.write('/ppp/secret/set', [
                `=.id=${secrets[0]['.id']}`,
                `=password=${newPassword}`,
            ]);
            await this.desconectarSesion(creds, name);
        });
    }
    async listarSecrets(creds, filter) {
        return this.pool.execute(creds, async (api) => {
            const args = filter ? [`?name=${filter}`] : [];
            return api.write('/ppp/secret/print', args);
        });
    }
    async listarSesionesActivas(creds) {
        return this.pool.execute(creds, async (api) => {
            return api.write('/ppp/active/print');
        });
    }
    async getSesion(creds, name) {
        const sessions = await this.pool.execute(creds, (api) => api.write('/ppp/active/print', [`?name=${name}`]));
        return (sessions[0] || null);
    }
    async listarPerfiles(creds) {
        return this.pool.execute(creds, (api) => api.write('/ppp/profile/print'));
    }
    async crearPerfilSiNoExiste(creds, nombre, params) {
        await this.pool.execute(creds, async (api) => {
            const existing = await api.write('/ppp/profile/print', [`?name=${nombre}`]);
            if (existing.length > 0)
                return;
            await api.write('/ppp/profile/add', [
                `=name=${nombre}`,
                ...(params.rateLimit ? [`=rate-limit=${params.rateLimit}`] : []),
                ...(params.sessionTimeout ? [`=session-timeout=${params.sessionTimeout}`] : []),
                `=use-compression=no`,
                `=use-encryption=no`,
            ]);
            this.logger.log(`Perfil PPPoE creado: ${nombre} en ${creds.ip}`);
        });
    }
    async getTraficoSesion(creds, name) {
        const session = await this.getSesion(creds, name);
        if (!session)
            return null;
        return {
            rxBytes: parseInt(session['rx-bytes'] || '0', 10),
            txBytes: parseInt(session['tx-bytes'] || '0', 10),
            uptime: session.uptime || '0s',
        };
    }
};
exports.PppoeService = PppoeService;
exports.PppoeService = PppoeService = PppoeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool])
], PppoeService);
//# sourceMappingURL=pppoe.service.js.map