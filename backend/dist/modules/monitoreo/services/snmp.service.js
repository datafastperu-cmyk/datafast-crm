"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SnmpService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnmpService = void 0;
const common_1 = require("@nestjs/common");
let SnmpService = SnmpService_1 = class SnmpService {
    constructor() {
        this.logger = new common_1.Logger(SnmpService_1.name);
    }
    async getSystemInfo(host, community = 'public', version = 2, extended = false) {
        try {
            const session = await this._createSession(host, community, version);
            if (!session)
                return null;
            const result = await this._get(session, [
                '1.3.6.1.2.1.1.1.0',
                '1.3.6.1.2.1.1.3.0',
                '1.3.6.1.2.1.1.5.0',
            ]);
            session.close();
            return {
                sysDescr: result['1.3.6.1.2.1.1.1.0'] ?? '',
                sysUpTime: Number(result['1.3.6.1.2.1.1.3.0'] ?? 0),
                sysName: result['1.3.6.1.2.1.1.5.0'] ?? host,
                cpuPct: null,
                memoriaPct: null,
                temperatura: null,
            };
        }
        catch (err) {
            this.logger.warn(`SNMP error en ${host}: ${err.message}`);
            return null;
        }
    }
    async getCpuMemory(host, community = 'public', version = 2) {
        return { cpu: null, memory: null };
    }
    async getInterfaces(host, community = 'public', version = 2) {
        return [];
    }
    async getTraficoInterfaz(host, community, ifIndex, version = 2) {
        return null;
    }
    async testConnection(host, community = 'public', version = 2) {
        const info = await this.getSystemInfo(host, community, version);
        return info !== null;
    }
    async _createSession(host, community, version) {
        try {
            const snmp = await Promise.resolve().then(() => require('net-snmp')).catch(() => null);
            if (!snmp)
                return null;
            const v = version === 1 ? snmp.Version1 : snmp.Version2c;
            return snmp.createSession(host, community, { version: v, timeout: 5000 });
        }
        catch {
            return null;
        }
    }
    _get(session, oids) {
        return new Promise((resolve, reject) => {
            session.get(oids, (err, varbinds) => {
                if (err) {
                    reject(err);
                    return;
                }
                const r = {};
                for (const vb of varbinds)
                    r[vb.oid] = vb.value?.toString() ?? null;
                resolve(r);
            });
        });
    }
};
exports.SnmpService = SnmpService;
exports.SnmpService = SnmpService = SnmpService_1 = __decorate([
    (0, common_1.Injectable)()
], SnmpService);
//# sourceMappingURL=snmp.service.js.map