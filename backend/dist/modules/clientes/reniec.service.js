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
var ReniecService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReniecService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const cache_manager_1 = require("@nestjs/cache-manager");
const common_2 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
let ReniecService = ReniecService_1 = class ReniecService {
    constructor(http, config, cache) {
        this.http = http;
        this.config = config;
        this.cache = cache;
        this.logger = new common_1.Logger(ReniecService_1.name);
        this.CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    }
    async consultarDni(dni) {
        const dniClean = dni.trim().replace(/\D/g, '');
        if (dniClean.length !== 8) {
            throw new common_1.BadRequestException('El DNI debe tener exactamente 8 dígitos');
        }
        const cacheKey = `reniec:dni:${dniClean}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            this.logger.debug(`RENIEC cache hit: DNI ${dniClean}`);
            return { ...cached, fuente: cached.fuente + ' (cache)' };
        }
        const providers = [
            () => this.consultarApisNetPe(dniClean),
            () => this.consultarApiPeru(dniClean),
            () => this.consultarConsultaPe(dniClean),
        ];
        let lastError;
        for (const provider of providers) {
            try {
                const result = await provider();
                if (result) {
                    await this.cache.set(cacheKey, result, this.CACHE_TTL_MS);
                    this.logger.log(`RENIEC OK: ${dniClean} → ${result.nombreCompleto}`);
                    return result;
                }
            }
            catch (error) {
                lastError = error;
                this.logger.warn(`RENIEC provider failed: ${error.message}`);
                continue;
            }
        }
        this.logger.error(`RENIEC: todos los proveedores fallaron para DNI ${dniClean}`);
        throw new common_1.ServiceUnavailableException('No se pudo consultar RENIEC en este momento. Ingresa los datos manualmente.');
    }
    async consultarApisNetPe(dni) {
        const url = this.config.get('app.reniec.url', 'https://api.apis.net.pe/v2');
        const token = this.config.get('app.reniec.token');
        if (!token)
            throw new Error('Token RENIEC no configurado (apis.net.pe)');
        const response = await (0, rxjs_1.firstValueFrom)(this.http.get(`${url}/reniec/dni`, {
            params: { numero: dni },
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
            timeout: 8000,
        }));
        const data = response.data;
        if (!data?.nombres)
            throw new Error('apis.net.pe: respuesta sin datos de nombres');
        return this.normalizar({
            nombres: data.nombres,
            apellidoPaterno: data.apellidoPaterno,
            apellidoMaterno: data.apellidoMaterno,
            dni,
            direccion: data.direccion,
            ubigeo: data.ubigeo,
            fuente: 'apis.net.pe',
            raw: data,
        });
    }
    async consultarApiPeru(dni) {
        const token = this.config.get('app.reniec.token');
        if (!token)
            throw new Error('Token no configurado');
        const response = await (0, rxjs_1.firstValueFrom)(this.http.get('https://apiperu.dev/api/dni', {
            params: { dni },
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
            timeout: 8000,
        }));
        const data = response.data?.data;
        if (!data?.nombre)
            throw new Error('apiperu.dev: sin datos');
        return this.normalizar({
            nombres: data.nombre,
            apellidoPaterno: data.apellido_paterno,
            apellidoMaterno: data.apellido_materno,
            dni,
            direccion: data.direccion,
            fuente: 'apiperu.dev',
            raw: data,
        });
    }
    async consultarConsultaPe(dni) {
        const token = this.config.get('app.reniec.token');
        if (!token)
            throw new Error('Token no configurado');
        const response = await (0, rxjs_1.firstValueFrom)(this.http.get(`https://api.consulta.pe/v1/dni/${dni}`, {
            headers: {
                'X-Api-Key': token,
                Accept: 'application/json',
            },
            timeout: 8000,
        }));
        const data = response.data;
        if (!data?.nombre_completo)
            throw new Error('consulta.pe: sin datos');
        const partes = data.nombre_completo.split(' ');
        return this.normalizar({
            nombres: partes.slice(2).join(' '),
            apellidoPaterno: partes[0] || '',
            apellidoMaterno: partes[1] || '',
            dni,
            fuente: 'consulta.pe',
            raw: data,
        });
    }
    normalizar(params) {
        const nombres = this.capitalizarNombre(params.nombres?.trim() || '');
        const apellidoPaterno = this.capitalizarNombre(params.apellidoPaterno?.trim() || '');
        const apellidoMaterno = this.capitalizarNombre(params.apellidoMaterno?.trim() || '');
        const nombreCompleto = [nombres, apellidoPaterno, apellidoMaterno]
            .filter(Boolean)
            .join(' ');
        return {
            nombres,
            apellidoPaterno,
            apellidoMaterno,
            nombreCompleto,
            dni: params.dni,
            direccion: params.direccion,
            ubigeo: params.ubigeo,
            fuente: params.fuente,
            consultadoEn: new Date().toISOString(),
        };
    }
    capitalizarNombre(nombre) {
        const excepciones = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E']);
        return nombre
            .toLowerCase()
            .split(' ')
            .map((word, idx) => {
            if (idx > 0 && excepciones.has(word.toUpperCase()))
                return word;
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
            .join(' ');
    }
    async consultarRuc(ruc) {
        const rucClean = ruc.trim().replace(/\D/g, '');
        if (rucClean.length !== 11) {
            throw new common_1.BadRequestException('El RUC debe tener 11 dígitos');
        }
        const cacheKey = `reniec:ruc:${rucClean}`;
        const cached = await this.cache.get(cacheKey);
        if (cached)
            return cached;
        const url = this.config.get('app.reniec.url', 'https://api.apis.net.pe/v2');
        const token = this.config.get('app.reniec.token');
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.http.get(`${url}/sunat/ruc`, {
                params: { numero: rucClean },
                headers: { Authorization: `Bearer ${token}` },
                timeout: 8000,
            }));
            const data = response.data;
            const result = {
                razonSocial: data.razonSocial || data.nombre || '',
                estado: data.estado || 'ACTIVO',
                direccion: data.direccion,
            };
            await this.cache.set(cacheKey, result, this.CACHE_TTL_MS);
            return result;
        }
        catch (error) {
            throw new common_1.ServiceUnavailableException('No se pudo consultar el RUC. Ingresa los datos manualmente.');
        }
    }
};
exports.ReniecService = ReniecService;
exports.ReniecService = ReniecService = ReniecService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_2.Inject)(cache_manager_1.CACHE_MANAGER)),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService, Object])
], ReniecService);
//# sourceMappingURL=reniec.service.js.map