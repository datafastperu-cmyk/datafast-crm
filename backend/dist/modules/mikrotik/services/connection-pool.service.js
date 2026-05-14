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
var RouterConnectionPool_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouterConnectionPool = void 0;
const common_1 = require("@nestjs/common");
const node_routeros_1 = require("node-routeros");
const encryption_util_1 = require("../../../common/utils/encryption.util");
let RouterConnectionPool = RouterConnectionPool_1 = class RouterConnectionPool {
    constructor() {
        this.logger = new common_1.Logger(RouterConnectionPool_1.name);
        this.pool = new Map();
        this.MAX_PER_ROUTER = 3;
        this.IDLE_TIMEOUT_MS = 5 * 60 * 1000;
        this.CONNECT_TIMEOUT = 15_000;
        this.cleanupInterval = setInterval(() => this.cleanup(), 2 * 60 * 1000);
    }
    async acquire(creds) {
        const routerId = creds.id;
        const existing = this.pool.get(routerId) || [];
        const available = existing.find((c) => !c.busy);
        if (available) {
            available.busy = true;
            available.usedAt = new Date();
            this.logger.debug(`Pool hit: router ${routerId} | pool size: ${existing.length}`);
            return available.api;
        }
        if (existing.length >= this.MAX_PER_ROUTER) {
            throw new Error(`Pool exhausto para router ${routerId}: ${existing.length}/${this.MAX_PER_ROUTER} conexiones en uso. ` +
                `Intenta en unos segundos.`);
        }
        const api = await this.connect(creds);
        const conn = {
            api,
            routerId,
            usedAt: new Date(),
            busy: true,
            version: creds.version,
        };
        this.pool.set(routerId, [...existing, conn]);
        this.logger.debug(`Nueva conexión router ${routerId} | pool: ${existing.length + 1}`);
        return api;
    }
    release(routerId, api) {
        const conns = this.pool.get(routerId);
        if (!conns)
            return;
        const conn = conns.find((c) => c.api === api);
        if (conn) {
            conn.busy = false;
            conn.usedAt = new Date();
        }
    }
    async invalidate(routerId) {
        const conns = this.pool.get(routerId) || [];
        for (const c of conns) {
            try {
                await c.api.close();
            }
            catch { }
        }
        this.pool.delete(routerId);
        this.logger.log(`Pool invalidado: router ${routerId}`);
    }
    async connectDirect(creds) {
        return this.connect(creds);
    }
    cleanup() {
        const now = Date.now();
        let removed = 0;
        for (const [routerId, conns] of this.pool.entries()) {
            const activas = conns.filter((c) => {
                const idle = now - c.usedAt.getTime();
                if (!c.busy && idle > this.IDLE_TIMEOUT_MS) {
                    try {
                        c.api.close();
                    }
                    catch { }
                    removed++;
                    return false;
                }
                return true;
            });
            if (activas.length === 0) {
                this.pool.delete(routerId);
            }
            else {
                this.pool.set(routerId, activas);
            }
        }
        if (removed > 0) {
            this.logger.debug(`Pool cleanup: ${removed} conexiones inactivas eliminadas`);
        }
    }
    async connect(creds) {
        let password;
        try {
            password = (0, encryption_util_1.decrypt)(creds.passwordCifrado);
        }
        catch {
            password = creds.passwordCifrado;
        }
        const api = new node_routeros_1.RouterOSAPI({
            host: creds.ip,
            user: creds.user,
            password,
            port: creds.port,
            timeout: creds.timeoutSec,
            tls: creds.useSsl ? { rejectUnauthorized: false } : undefined,
        });
        try {
            await Promise.race([
                api.connect(),
                new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout conectando a ${creds.ip}:${creds.port}`)), this.CONNECT_TIMEOUT)),
            ]);
            this.logger.log(`Conectado: ${creds.ip}:${creds.port} (RouterOS ${creds.version})`);
            return api;
        }
        catch (error) {
            this.logger.error(`Error conectando a ${creds.ip}: ${error.message}`);
            throw new Error(`No se pudo conectar al router ${creds.ip}: ${error.message}`);
        }
    }
    async execute(creds, fn, retries = 2) {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            let api = null;
            try {
                api = await this.acquire(creds);
                const result = await fn(api);
                this.release(creds.id, api);
                return result;
            }
            catch (error) {
                lastError = error;
                if (api && this.isConnectionError(error)) {
                    this.logger.warn(`Error de conexión router ${creds.id} (intento ${attempt + 1}): ${error.message}`);
                    await this.invalidate(creds.id);
                    if (attempt < retries) {
                        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
                    }
                }
                else {
                    if (api)
                        this.release(creds.id, api);
                    throw error;
                }
            }
        }
        throw new Error(`Error persistente en router ${creds.id}: ${lastError.message}`);
    }
    isConnectionError(error) {
        const msg = error.message?.toLowerCase() || '';
        return (msg.includes('connection') ||
            msg.includes('timeout') ||
            msg.includes('econnrefused') ||
            msg.includes('enotfound') ||
            msg.includes('closed') ||
            msg.includes('reset'));
    }
    async onModuleDestroy() {
        clearInterval(this.cleanupInterval);
        for (const [routerId, conns] of this.pool.entries()) {
            for (const c of conns) {
                try {
                    await c.api.close();
                }
                catch { }
            }
        }
        this.pool.clear();
        this.logger.log('Pool de conexiones RouterOS cerrado');
    }
};
exports.RouterConnectionPool = RouterConnectionPool;
exports.RouterConnectionPool = RouterConnectionPool = RouterConnectionPool_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], RouterConnectionPool);
//# sourceMappingURL=connection-pool.service.js.map