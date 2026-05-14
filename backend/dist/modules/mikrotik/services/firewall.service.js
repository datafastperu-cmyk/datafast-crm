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
var FirewallService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirewallService = exports.ADDRESS_LIST_PORTAL = exports.ADDRESS_LIST_PRORROGA = exports.ADDRESS_LIST_MOROSOS = void 0;
const common_1 = require("@nestjs/common");
const connection_pool_service_1 = require("./connection-pool.service");
exports.ADDRESS_LIST_MOROSOS = 'morosos';
exports.ADDRESS_LIST_PRORROGA = 'prorroga';
exports.ADDRESS_LIST_PORTAL = 'portal-pago';
let FirewallService = FirewallService_1 = class FirewallService {
    constructor(pool) {
        this.pool = pool;
        this.logger = new common_1.Logger(FirewallService_1.name);
    }
    async suspenderCliente(creds, ip, clienteId, comment) {
        await this.pool.execute(creds, async (api) => {
            const existing = await api.write('/ip/firewall/address-list/print', [
                `?list=${exports.ADDRESS_LIST_MOROSOS}`,
                `?address=${ip}`,
            ]);
            if (existing.length > 0) {
                this.logger.debug(`IP ${ip} ya en address-list ${exports.ADDRESS_LIST_MOROSOS}`);
                return;
            }
            await api.write('/ip/firewall/address-list/add', [
                `=list=${exports.ADDRESS_LIST_MOROSOS}`,
                `=address=${ip}`,
                `=comment=${comment || `ClienteID:${clienteId}`}`,
            ]);
            this.logger.log(`IP suspendida: ${ip} → ${exports.ADDRESS_LIST_MOROSOS} en ${creds.ip}`);
        });
    }
    async reactivarCliente(creds, ip) {
        await this.pool.execute(creds, async (api) => {
            for (const lista of [exports.ADDRESS_LIST_MOROSOS, exports.ADDRESS_LIST_PRORROGA]) {
                const entries = await api.write('/ip/firewall/address-list/print', [
                    `?list=${lista}`,
                    `?address=${ip}`,
                ]);
                for (const entry of entries) {
                    await api.write('/ip/firewall/address-list/remove', [
                        `=.id=${entry['.id']}`,
                    ]);
                }
            }
            this.logger.log(`IP reactivada: ${ip} en ${creds.ip}`);
        });
    }
    async estaEnListaMorosos(creds, ip) {
        const entries = await this.pool.execute(creds, (api) => api.write('/ip/firewall/address-list/print', [
            `?list=${exports.ADDRESS_LIST_MOROSOS}`,
            `?address=${ip}`,
        ]));
        return entries.length > 0;
    }
    async listarMorosos(creds) {
        const entries = await this.pool.execute(creds, (api) => api.write('/ip/firewall/address-list/print', [`?list=${exports.ADDRESS_LIST_MOROSOS}`]));
        return entries.map((e) => ({
            ip: e.address,
            comment: e.comment || '',
            addedAt: e['creation-time'] || '',
        }));
    }
    async aplicarProrroga(creds, ip, comment) {
        await this.pool.execute(creds, async (api) => {
            const morosos = await api.write('/ip/firewall/address-list/print', [
                `?list=${exports.ADDRESS_LIST_MOROSOS}`, `?address=${ip}`,
            ]);
            for (const e of morosos) {
                await api.write('/ip/firewall/address-list/remove', [`=.id=${e['.id']}`]);
            }
            const existing = await api.write('/ip/firewall/address-list/print', [
                `?list=${exports.ADDRESS_LIST_PRORROGA}`, `?address=${ip}`,
            ]);
            if (existing.length === 0) {
                await api.write('/ip/firewall/address-list/add', [
                    `=list=${exports.ADDRESS_LIST_PRORROGA}`,
                    `=address=${ip}`,
                    `=comment=${comment || 'Prorroga activa'}`,
                ]);
            }
            this.logger.log(`Prórroga aplicada: ${ip} en ${creds.ip}`);
        });
    }
    async configurarReglasControl(creds) {
        await this.pool.execute(creds, async (api) => {
            await this.agregarReglaFirewallSiNoExiste(api, {
                chain: 'forward',
                srcList: exports.ADDRESS_LIST_MOROSOS,
                action: 'drop',
                comment: 'FibraNet: Bloquear morosos',
            });
            await this.agregarReglaFirewallSiNoExiste(api, {
                chain: 'forward',
                srcList: exports.ADDRESS_LIST_MOROSOS,
                dstPort: '80,443',
                proto: 'tcp',
                action: 'accept',
                comment: 'FibraNet: Morosos portal pago',
                position: 'top',
            });
            await this.agregarReglaFirewallSiNoExiste(api, {
                chain: 'forward',
                srcList: exports.ADDRESS_LIST_PRORROGA,
                dstPort: '80,443,53',
                proto: 'tcp',
                action: 'accept',
                comment: 'FibraNet: Prorroga acceso web',
            });
            await this.agregarReglaFirewallSiNoExiste(api, {
                chain: 'forward',
                srcList: exports.ADDRESS_LIST_PRORROGA,
                action: 'drop',
                comment: 'FibraNet: Prorroga bloquear resto',
            });
            this.logger.log(`Reglas de control configuradas en ${creds.ip}`);
        });
    }
    async agregarReglaFirewallSiNoExiste(api, params) {
        const existing = await api.write('/ip/firewall/filter/print', [
            `?comment=${params.comment}`,
        ]);
        if (existing.length > 0)
            return;
        const args = [
            `=chain=${params.chain}`,
            ...(params.srcList ? [`=src-address-list=${params.srcList}`] : []),
            ...(params.proto ? [`=protocol=${params.proto}`] : []),
            ...(params.dstPort ? [`=dst-port=${params.dstPort}`] : []),
            `=action=${params.action}`,
            `=comment=${params.comment}`,
        ];
        if (params.position === 'top') {
            await api.write('/ip/firewall/filter/add', [...args, `=place-before=0`]);
        }
        else {
            await api.write('/ip/firewall/filter/add', args);
        }
    }
    async crearDhcpBinding(creds, binding) {
        return this.pool.execute(creds, async (api) => {
            const existing = await api.write('/ip/dhcp-server/lease/print', [
                `?mac-address=${binding.macAddress}`,
            ]);
            const macFormatted = binding.macAddress.toUpperCase()
                .replace(/[^A-F0-9]/g, '')
                .match(/.{2}/g).join(':');
            if (existing.length > 0) {
                await api.write('/ip/dhcp-server/lease/set', [
                    `=.id=${existing[0]['.id']}`,
                    `=address=${binding.ipAddress}`,
                    `=mac-address=${macFormatted}`,
                    ...(binding.hostname ? [`=host-name=${binding.hostname}`] : []),
                    ...(binding.comment ? [`=comment=${binding.comment}`] : []),
                ]);
                this.logger.log(`DHCP binding actualizado: ${macFormatted} → ${binding.ipAddress}`);
                return existing[0]['.id'];
            }
            const result = await api.write('/ip/dhcp-server/lease/add', [
                `=address=${binding.ipAddress}`,
                `=mac-address=${macFormatted}`,
                ...(binding.server ? [`=server=${binding.server}`] : []),
                ...(binding.hostname ? [`=host-name=${binding.hostname}`] : []),
                ...(binding.comment ? [`=comment=${binding.comment}`] : []),
            ]);
            this.logger.log(`DHCP binding creado: ${macFormatted} → ${binding.ipAddress} en ${creds.ip}`);
            return result?.[0]?.ret || '';
        });
    }
    async eliminarDhcpBinding(creds, macAddress) {
        await this.pool.execute(creds, async (api) => {
            const leases = await api.write('/ip/dhcp-server/lease/print', [
                `?mac-address=${macAddress.toUpperCase()}`,
            ]);
            for (const lease of leases) {
                await api.write('/ip/dhcp-server/lease/remove', [`=.id=${lease['.id']}`]);
            }
            this.logger.log(`DHCP binding eliminado: ${macAddress} en ${creds.ip}`);
        });
    }
    async listarDhcpLeases(creds) {
        return this.pool.execute(creds, (api) => api.write('/ip/dhcp-server/lease/print'));
    }
    async listarServidoresDhcp(creds) {
        return this.pool.execute(creds, (api) => api.write('/ip/dhcp-server/print'));
    }
};
exports.FirewallService = FirewallService;
exports.FirewallService = FirewallService = FirewallService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool])
], FirewallService);
//# sourceMappingURL=firewall.service.js.map