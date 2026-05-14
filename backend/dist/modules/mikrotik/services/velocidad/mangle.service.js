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
var MangleService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MangleService = void 0;
const common_1 = require("@nestjs/common");
const connection_pool_service_1 = require("../../services/connection-pool.service");
let MangleService = MangleService_1 = class MangleService {
    constructor(pool) {
        this.pool = pool;
        this.logger = new common_1.Logger(MangleService_1.name);
        this.PREFIX = 'fn';
    }
    async crearMangleCliente(creds, clienteId, ip, wanIface) {
        const marcas = this.generarNombresMarcas(clienteId);
        return this.pool.execute(creds, async (api) => {
            const wan = wanIface || await this.detectarWan(api);
            let reglasCreadas = 0;
            let reglasExistentes = 0;
            const r1 = await this.agregarMangleSiNoExiste(api, {
                chain: 'forward',
                inInterface: wan,
                dstAddress: ip,
                action: 'mark-connection',
                newConnMark: marcas.connMarkDown,
                passthrough: 'yes',
                comment: `${this.PREFIX}:cli:${clienteId}:conn-down`,
            });
            r1 ? reglasCreadas++ : reglasExistentes++;
            const r2 = await this.agregarMangleSiNoExiste(api, {
                chain: 'forward',
                connMark: marcas.connMarkDown,
                action: 'mark-packet',
                newPacketMark: marcas.packetMarkDown,
                passthrough: 'no',
                comment: `${this.PREFIX}:cli:${clienteId}:pkt-down`,
            });
            r2 ? reglasCreadas++ : reglasExistentes++;
            const r3 = await this.agregarMangleSiNoExiste(api, {
                chain: 'forward',
                outInterface: wan,
                srcAddress: ip,
                action: 'mark-connection',
                newConnMark: marcas.connMarkUp,
                passthrough: 'yes',
                comment: `${this.PREFIX}:cli:${clienteId}:conn-up`,
            });
            r3 ? reglasCreadas++ : reglasExistentes++;
            const r4 = await this.agregarMangleSiNoExiste(api, {
                chain: 'forward',
                connMark: marcas.connMarkUp,
                action: 'mark-packet',
                newPacketMark: marcas.packetMarkUp,
                passthrough: 'no',
                comment: `${this.PREFIX}:cli:${clienteId}:pkt-up`,
            });
            r4 ? reglasCreadas++ : reglasExistentes++;
            if (reglasCreadas > 0) {
                this.logger.log(`Mangle cliente ${clienteId} (${ip}): ` +
                    `${reglasCreadas} reglas creadas, ${reglasExistentes} ya existían en ${creds.ip}`);
            }
            return { reglasCreadas, reglasExistentes, marcas };
        });
    }
    async eliminarMangleCliente(creds, clienteId) {
        return this.pool.execute(creds, async (api) => {
            const reglas = await api.write('/ip/firewall/mangle/print', [
                `?comment~${this.PREFIX}:cli:${clienteId}`,
            ]).catch(() => []);
            let eliminadas = 0;
            for (const regla of reglas) {
                await api.write('/ip/firewall/mangle/remove', [`=.id=${regla['.id']}`]);
                eliminadas++;
            }
            if (eliminadas > 0) {
                this.logger.log(`Mangle eliminado: ${eliminadas} reglas del cliente ${clienteId} en ${creds.ip}`);
            }
            return eliminadas;
        });
    }
    async actualizarIpMangle(creds, clienteId, ipNueva) {
        await this.pool.execute(creds, async (api) => {
            const downConn = await api.write('/ip/firewall/mangle/print', [
                `?comment=${this.PREFIX}:cli:${clienteId}:conn-down`,
            ]).catch(() => []);
            for (const r of downConn) {
                await api.write('/ip/firewall/mangle/set', [
                    `=.id=${r['.id']}`,
                    `=dst-address=${ipNueva}`,
                ]);
            }
            const upConn = await api.write('/ip/firewall/mangle/print', [
                `?comment=${this.PREFIX}:cli:${clienteId}:conn-up`,
            ]).catch(() => []);
            for (const r of upConn) {
                await api.write('/ip/firewall/mangle/set', [
                    `=.id=${r['.id']}`,
                    `=src-address=${ipNueva}`,
                ]);
            }
            this.logger.log(`Mangle IP actualizada: cliente ${clienteId} → ${ipNueva} en ${creds.ip}`);
        });
    }
    async listarManglesFirebranet(creds) {
        return this.pool.execute(creds, async (api) => {
            const todas = await api.write('/ip/firewall/mangle/print');
            return todas.filter((r) => r.comment?.startsWith(this.PREFIX + ':cli:'));
        });
    }
    async setEstadoMangle(creds, clienteId, disabled) {
        await this.pool.execute(creds, async (api) => {
            const reglas = await api.write('/ip/firewall/mangle/print', [
                `?comment~${this.PREFIX}:cli:${clienteId}`,
            ]).catch(() => []);
            for (const r of reglas) {
                await api.write('/ip/firewall/mangle/set', [
                    `=.id=${r['.id']}`,
                    `=disabled=${disabled ? 'yes' : 'no'}`,
                ]);
            }
        });
    }
    generarNombresMarcas(clienteId) {
        const shortId = clienteId.replace(/-/g, '').substring(0, 12);
        return {
            clienteId,
            ip: '',
            connMarkDown: `${this.PREFIX}-${shortId}-cd`,
            connMarkUp: `${this.PREFIX}-${shortId}-cu`,
            packetMarkDown: `${this.PREFIX}-${shortId}-pd`,
            packetMarkUp: `${this.PREFIX}-${shortId}-pu`,
        };
    }
    async agregarMangleSiNoExiste(api, params) {
        const existing = await api.write('/ip/firewall/mangle/print', [
            `?comment=${params.comment}`,
        ]).catch(() => []);
        if (existing.length > 0)
            return false;
        const args = [
            `=chain=${params.chain}`,
            `=action=${params.action}`,
            `=passthrough=${params.passthrough}`,
            `=comment=${params.comment}`,
        ];
        if (params.inInterface)
            args.push(`=in-interface=${params.inInterface}`);
        if (params.outInterface)
            args.push(`=out-interface=${params.outInterface}`);
        if (params.srcAddress)
            args.push(`=src-address=${params.srcAddress}`);
        if (params.dstAddress)
            args.push(`=dst-address=${params.dstAddress}`);
        if (params.connMark)
            args.push(`=connection-mark=${params.connMark}`);
        if (params.newConnMark)
            args.push(`=new-connection-mark=${params.newConnMark}`);
        if (params.newPacketMark)
            args.push(`=new-packet-mark=${params.newPacketMark}`);
        await api.write('/ip/firewall/mangle/add', args);
        return true;
    }
    async detectarWan(api) {
        try {
            const routes = await api.write('/ip/route/print', [
                '?dst-address=0.0.0.0/0', '?!disabled',
            ]);
            if (routes.length && routes[0].gateway) {
                const arp = await api.write('/ip/arp/print', [
                    `?address=${routes[0].gateway}`,
                ]);
                if (arp.length && arp[0].interface)
                    return arp[0].interface;
            }
        }
        catch { }
        const ifaces = await api.write('/interface/print', ['?!disabled']).catch(() => []);
        const wan = ifaces.find((i) => /wan|internet|ether1|uplink/i.test(i.name || ''));
        return wan?.name || 'ether1';
    }
};
exports.MangleService = MangleService;
exports.MangleService = MangleService = MangleService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool])
], MangleService);
//# sourceMappingURL=mangle.service.js.map