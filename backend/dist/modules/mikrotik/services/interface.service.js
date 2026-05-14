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
var InterfaceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterfaceService = void 0;
const common_1 = require("@nestjs/common");
const connection_pool_service_1 = require("./connection-pool.service");
let InterfaceService = InterfaceService_1 = class InterfaceService {
    constructor(pool) {
        this.pool = pool;
        this.logger = new common_1.Logger(InterfaceService_1.name);
    }
    async getRecursos(creds) {
        return this.pool.execute(creds, async (api) => {
            const [res] = await api.write('/system/resource/print');
            const uptime = res['uptime'] || '0s';
            return {
                version: res['version'] || '',
                buildTime: res['build-time'] || '',
                freeMemory: parseInt(res['free-memory'] || '0', 10),
                totalMemory: parseInt(res['total-memory'] || '0', 10),
                cpuLoad: parseInt(res['cpu-load'] || '0', 10),
                cpuFreq: parseInt(res['cpu-frequency'] || '0', 10),
                freeHdd: parseInt(res['free-hdd-space'] || '0', 10),
                totalHdd: parseInt(res['total-hdd-space'] || '0', 10),
                uptime: uptime,
                uptimeSeconds: this.parseUptime(uptime),
                boardName: res['board-name'] || '',
                platform: res['platform'] || '',
                temperature: parseInt(res['temperature'] || '0', 10) || undefined,
            };
        });
    }
    async getIdentity(creds) {
        const [ident] = await this.pool.execute(creds, (api) => api.write('/system/identity/print'));
        return ident?.name || '';
    }
    async listarInterfaces(creds) {
        return this.pool.execute(creds, async (api) => {
            const ifaces = await api.write('/interface/print');
            const stats = await api.write('/interface/monitor-traffic', [
                `=interface=${ifaces.map((i) => i.name).join(',')}`,
                `=once=`,
            ]).catch(() => []);
            const statsMap = new Map();
            for (const s of stats) {
                statsMap.set(s.name, s);
            }
            return ifaces.map((i) => {
                const s = statsMap.get(i.name) || {};
                return {
                    name: i.name,
                    type: i.type || 'ether',
                    macAddress: i['mac-address'] || '',
                    mtu: parseInt(i.mtu || '1500', 10),
                    running: i.running === 'true',
                    disabled: i.disabled === 'true',
                    rxBytes: parseInt(i['rx-byte'] || '0', 10),
                    txBytes: parseInt(i['tx-byte'] || '0', 10),
                    rxRate: parseInt(s['rx-bits-per-second'] || '0', 10),
                    txRate: parseInt(s['tx-bits-per-second'] || '0', 10),
                    rxErrors: parseInt(i['rx-error'] || '0', 10),
                    txErrors: parseInt(i['tx-error'] || '0', 10),
                    lastLinkUp: i['last-link-up-time'],
                    comment: i.comment,
                };
            });
        });
    }
    async monitorearInterface(creds, ifaceName, samples = 3) {
        return this.pool.execute(creds, async (api) => {
            const results = [];
            for (let i = 0; i < samples; i++) {
                const [data] = await api.write('/interface/monitor-traffic', [
                    `=interface=${ifaceName}`,
                    `=once=`,
                ]);
                results.push({
                    rxBps: parseInt(data?.['rx-bits-per-second'] || '0', 10),
                    txBps: parseInt(data?.['tx-bits-per-second'] || '0', 10),
                    rxPps: parseInt(data?.['rx-packets-per-second'] || '0', 10),
                    txPps: parseInt(data?.['tx-packets-per-second'] || '0', 10),
                });
                if (i < samples - 1)
                    await new Promise((r) => setTimeout(r, 1000));
            }
            return results;
        });
    }
    async listarIps(creds) {
        const ips = await this.pool.execute(creds, (api) => api.write('/ip/address/print'));
        return ips.map((ip) => ({
            address: ip.address,
            network: ip.network,
            interface: ip.interface,
            comment: ip.comment,
            disabled: ip.disabled === 'true',
        }));
    }
    async getArp(creds, ip) {
        const args = ip ? [`?address=${ip}`] : [];
        const rows = await this.pool.execute(creds, (api) => api.write('/ip/arp/print', args));
        return rows.map((r) => ({
            address: r.address,
            macAddress: r['mac-address'] || '',
            interface: r.interface,
            dynamic: r.dynamic === 'true',
            complete: r.complete === 'true',
        }));
    }
    async listarRutas(creds) {
        return this.pool.execute(creds, (api) => api.write('/ip/route/print'));
    }
    async getLog(creds, limit = 50) {
        const logs = await this.pool.execute(creds, (api) => api.write('/log/print'));
        return logs.slice(-limit).reverse();
    }
    async detectarVersion(creds) {
        try {
            const recursos = await this.getRecursos(creds);
            const version = recursos.version || '';
            return version.startsWith('7') ? 'v7' : 'v6';
        }
        catch {
            return 'v6';
        }
    }
    async ping(creds, destino, count = 4) {
        return this.pool.execute(creds, async (api) => {
            const result = await api.write('/ping', [
                `=address=${destino}`,
                `=count=${count}`,
                `=interval=0.5`,
            ]);
            const times = result
                .filter((r) => r.time && r.time !== 'timeout')
                .map((r) => {
                const ms = r.time?.replace('ms', '') || '0';
                return parseFloat(ms);
            });
            const loss = result.filter((r) => r.status === 'timeout').length;
            const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
            return {
                avg: Math.round(avg * 10) / 10,
                min: times.length ? Math.min(...times) : 0,
                max: times.length ? Math.max(...times) : 0,
                loss: Math.round((loss / count) * 100),
            };
        });
    }
    parseUptime(uptime) {
        let seconds = 0;
        const weeks = uptime.match(/(\d+)w/);
        const days = uptime.match(/(\d+)d/);
        const hours = uptime.match(/(\d+)h/);
        const minutes = uptime.match(/(\d+)m/);
        const secs = uptime.match(/(\d+)s/);
        if (weeks)
            seconds += parseInt(weeks[1], 10) * 7 * 24 * 3600;
        if (days)
            seconds += parseInt(days[1], 10) * 24 * 3600;
        if (hours)
            seconds += parseInt(hours[1], 10) * 3600;
        if (minutes)
            seconds += parseInt(minutes[1], 10) * 60;
        if (secs)
            seconds += parseInt(secs[1], 10);
        return seconds;
    }
};
exports.InterfaceService = InterfaceService;
exports.InterfaceService = InterfaceService = InterfaceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool])
], InterfaceService);
//# sourceMappingURL=interface.service.js.map