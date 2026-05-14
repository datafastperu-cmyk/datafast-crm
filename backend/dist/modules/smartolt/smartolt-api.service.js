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
var SmartoltApiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartoltApiService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
let SmartoltApiService = SmartoltApiService_1 = class SmartoltApiService {
    constructor(http, config) {
        this.http = http;
        this.config = config;
        this.logger = new common_1.Logger(SmartoltApiService_1.name);
        this.TIMEOUT_MS = 30_000;
        this.baseUrl = config.get('app.smartolt.url', '');
        this.token = config.get('app.smartolt.token', '');
    }
    async listarOlts() {
        const res = await this.get('/api/olt');
        return res || [];
    }
    async getOlt(oltId) {
        const olt = await this.get(`/api/olt/${oltId}`);
        if (!olt)
            throw new common_1.NotFoundException(`OLT ${oltId} no encontrada en SmartOLT`);
        return olt;
    }
    async listarOnusDeOlt(oltId) {
        const res = await this.get(`/api/olt/${oltId}/onu`);
        return res || [];
    }
    async getOnu(oltId, onuId) {
        const onu = await this.get(`/api/olt/${oltId}/onu/${onuId}`);
        if (!onu)
            throw new common_1.NotFoundException(`ONU ${onuId} no encontrada en SmartOLT`);
        return onu;
    }
    async getOnuBySerial(serial) {
        try {
            const res = await this.get(`/api/onu/search`, { serial });
            return res?.[0] || null;
        }
        catch {
            return null;
        }
    }
    async getSeñalOnu(oltId, onuId) {
        const data = await this.get(`/api/olt/${oltId}/onu/${onuId}/signal`);
        return {
            rxPower: data?.rx_power || 0,
            txPower: data?.tx_power || 0,
            temperature: data?.temperature || 0,
            voltaje: data?.voltage || 0,
        };
    }
    async listarOnusNoAprovisionadas(oltId) {
        const endpoint = oltId
            ? `/api/olt/${oltId}/onu/unprovisioned`
            : `/api/onu/unprovisioned`;
        const res = await this.get(endpoint);
        return res || [];
    }
    async detectarOnuEnPuerto(oltId, ponPort) {
        const todas = await this.listarOnusNoAprovisionadas(oltId);
        return todas.find((o) => o.pon_port === ponPort) || null;
    }
    async listarPerfiles() {
        const res = await this.get('/api/profile');
        return res || [];
    }
    async getPerfilPorNombre(nombre) {
        const perfiles = await this.listarPerfiles();
        return perfiles.find((p) => p.name.toLowerCase() === nombre.toLowerCase()) || null;
    }
    async aprovisionarOnu(payload) {
        this.logger.log(`Aprovisionando ONU: SN=${payload.serial} | ` +
            `OLT=${payload.olt_id} | PON=${payload.pon_port} | ` +
            `Perfil=${payload.profile} | VLAN=${payload.vlan}`);
        const body = {
            serial: payload.serial.toUpperCase(),
            olt_id: payload.olt_id,
            pon_port: payload.pon_port,
            profile: payload.profile,
            vlan: payload.vlan,
            vlan_mode: payload.vlan_mode || 'access',
            description: payload.description || '',
        };
        const onu = await this.post('/api/onu/provision', body);
        if (!onu?.id) {
            throw new common_1.BadRequestException(`SmartOLT no retornó un ID de ONU válido para SN ${payload.serial}`);
        }
        this.logger.log(`ONU aprovisionada: ID=${onu.id} | SN=${payload.serial}`);
        return onu;
    }
    async eliminarProvision(oltId, onuId) {
        this.logger.log(`Eliminando provisión ONU: ID=${onuId} en OLT=${oltId}`);
        await this.delete(`/api/olt/${oltId}/onu/${onuId}`);
        this.logger.log(`Provisión eliminada: ONU ${onuId}`);
    }
    async eliminarProvisionPorSerial(serial) {
        const onu = await this.getOnuBySerial(serial);
        if (!onu) {
            this.logger.warn(`ONU con SN ${serial} no encontrada en SmartOLT — omitiendo eliminación`);
            return;
        }
        await this.eliminarProvision(onu.olt_id, onu.id);
    }
    async reiniciarOnu(oltId, onuId) {
        await this.post(`/api/olt/${oltId}/onu/${onuId}/reboot`, {});
        this.logger.log(`ONU reiniciada: ${onuId}`);
    }
    async actualizarOnu(oltId, onuId, params) {
        const onu = await this.put(`/api/olt/${oltId}/onu/${onuId}`, params);
        this.logger.log(`ONU actualizada: ${onuId}`);
        return onu;
    }
    async getEstadisticasOlt(oltId) {
        const data = await this.get(`/api/olt/${oltId}/stats`).catch(() => null);
        return {
            onusOnline: data?.onu_online || 0,
            onusOffline: data?.onu_offline || 0,
            onusTotal: data?.onu_total || 0,
            rxPromedio: data?.rx_avg || 0,
            txPromedio: data?.tx_avg || 0,
        };
    }
    async verificarConectividad() {
        if (!this.baseUrl || !this.token) {
            return { conectado: false, mensaje: 'SmartOLT no está configurado (SMARTOLT_URL o SMARTOLT_TOKEN vacíos)' };
        }
        try {
            const data = await this.get('/api/health');
            return {
                conectado: true,
                version: data?.version,
                mensaje: `SmartOLT conectado | versión: ${data?.version || 'desconocida'}`,
            };
        }
        catch (error) {
            return {
                conectado: false,
                mensaje: `No se pudo conectar a SmartOLT: ${error.message}`,
            };
        }
    }
    getHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Client': 'FibraNet-ISP/1.0',
        };
    }
    getConfig(params) {
        return {
            headers: this.getHeaders(),
            timeout: this.TIMEOUT_MS,
            params,
        };
    }
    checkConfig() {
        if (!this.baseUrl) {
            throw new common_1.ServiceUnavailableException('SmartOLT no está configurado. Verifica SMARTOLT_URL en las variables de entorno.');
        }
        if (!this.token) {
            throw new common_1.ServiceUnavailableException('SmartOLT sin token de autenticación. Verifica SMARTOLT_TOKEN.');
        }
    }
    async get(endpoint, params) {
        this.checkConfig();
        try {
            const res = await (0, rxjs_1.firstValueFrom)(this.http.get(`${this.baseUrl}${endpoint}`, this.getConfig(params)));
            return res.data;
        }
        catch (error) {
            this.handleHttpError(error, 'GET', endpoint);
        }
    }
    async post(endpoint, body) {
        this.checkConfig();
        try {
            const res = await (0, rxjs_1.firstValueFrom)(this.http.post(`${this.baseUrl}${endpoint}`, body, this.getConfig()));
            return res.data;
        }
        catch (error) {
            this.handleHttpError(error, 'POST', endpoint);
        }
    }
    async put(endpoint, body) {
        this.checkConfig();
        try {
            const res = await (0, rxjs_1.firstValueFrom)(this.http.put(`${this.baseUrl}${endpoint}`, body, this.getConfig()));
            return res.data;
        }
        catch (error) {
            this.handleHttpError(error, 'PUT', endpoint);
        }
    }
    async delete(endpoint) {
        this.checkConfig();
        try {
            await (0, rxjs_1.firstValueFrom)(this.http.delete(`${this.baseUrl}${endpoint}`, this.getConfig()));
        }
        catch (error) {
            this.handleHttpError(error, 'DELETE', endpoint);
        }
    }
    handleHttpError(error, method, endpoint) {
        const status = error?.response?.status;
        const detail = error?.response?.data;
        const message = detail?.message || detail?.error || error.message;
        this.logger.error(`SmartOLT ${method} ${endpoint} → ${status || 'sin respuesta'}: ${message}`);
        if (status === 404) {
            throw new common_1.NotFoundException(`SmartOLT: recurso no encontrado (${endpoint})`);
        }
        if (status === 400) {
            throw new common_1.BadRequestException(`SmartOLT rechazó la solicitud: ${message}`);
        }
        if (status === 401 || status === 403) {
            throw new common_1.ServiceUnavailableException('Token de SmartOLT inválido o expirado. Verifica SMARTOLT_TOKEN.');
        }
        if (!status) {
            throw new common_1.ServiceUnavailableException(`SmartOLT no disponible: ${message}. Verifica SMARTOLT_URL.`);
        }
        throw new common_1.ServiceUnavailableException(`Error SmartOLT (${status}): ${message}`);
    }
};
exports.SmartoltApiService = SmartoltApiService;
exports.SmartoltApiService = SmartoltApiService = SmartoltApiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], SmartoltApiService);
//# sourceMappingURL=smartolt-api.service.js.map