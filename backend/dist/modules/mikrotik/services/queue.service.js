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
var QueueService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueService = void 0;
const common_1 = require("@nestjs/common");
const connection_pool_service_1 = require("./connection-pool.service");
let QueueService = QueueService_1 = class QueueService {
    constructor(pool) {
        this.pool = pool;
        this.logger = new common_1.Logger(QueueService_1.name);
    }
    async crearSimpleQueue(creds, params) {
        return this.pool.execute(creds, async (api) => {
            const existing = await api.write('/queue/simple/print', [`?name=${params.name}`]);
            const target = params.target.includes('/') ? params.target : `${params.target}/32`;
            const maxLimit = `${params.maxLimitUp}M/${params.maxLimitDown}M`;
            const burstArgs = [];
            if (params.burstLimitDown && params.burstLimitUp) {
                burstArgs.push(`=burst-limit=${params.burstLimitUp}M/${params.burstLimitDown}M`);
                burstArgs.push(`=burst-threshold=${params.burstThreshUp || params.maxLimitUp}M/${params.burstThreshDown || params.maxLimitDown}M`);
                burstArgs.push(`=burst-time=${params.burstTimeUp || 8}/${params.burstTimeDown || 8}`);
            }
            if (existing.length > 0) {
                await api.write('/queue/simple/set', [
                    `=.id=${existing[0]['.id']}`,
                    `=target=${target}`,
                    `=max-limit=${maxLimit}`,
                    ...burstArgs,
                    ...(params.comment ? [`=comment=${params.comment}`] : []),
                ]);
                this.logger.log(`Simple Queue actualizada: ${params.name} | ${maxLimit}`);
                return existing[0]['.id'];
            }
            const result = await api.write('/queue/simple/add', [
                `=name=${params.name}`,
                `=target=${target}`,
                `=max-limit=${maxLimit}`,
                `=queue=default-small/default-small`,
                ...burstArgs,
                ...(params.comment ? [`=comment=${params.comment}`] : []),
            ]);
            this.logger.log(`Simple Queue creada: ${params.name} | ${maxLimit} | target: ${target}`);
            return result?.[0]?.ret || '';
        });
    }
    async eliminarSimpleQueue(creds, name) {
        await this.pool.execute(creds, async (api) => {
            const queues = await api.write('/queue/simple/print', [`?name=${name}`]);
            if (queues.length === 0)
                return;
            await api.write('/queue/simple/remove', [`=.id=${queues[0]['.id']}`]);
            this.logger.log(`Simple Queue eliminada: ${name} en ${creds.ip}`);
        });
    }
    async listarSimpleQueues(creds) {
        return this.pool.execute(creds, (api) => api.write('/queue/simple/print'));
    }
    async tienePcqConfigurado(creds) {
        const types = await this.pool.execute(creds, (api) => api.write('/queue/type/print', ['?kind=pcq']));
        return types.length >= 2;
    }
    async configurarPcqCompleto(creds, params) {
        await this.pool.execute(creds, async (api) => {
            const isV7 = creds.version === 'v7';
            await this.crearQueueTypePcq(api, `${params.namePrefix}-pcq-down`, 'download', isV7);
            await this.crearQueueTypePcq(api, `${params.namePrefix}-pcq-up`, 'upload', isV7);
            const wanIface = await this.detectarInterfaceWan(api);
            await this.crearMangleRules(api, params.namePrefix, wanIface, isV7);
            await this.crearQueueTree(api, params.namePrefix, params.downloadMbps, params.uploadMbps, wanIface, isV7);
            this.logger.log(`PCQ configurado: ${params.namePrefix} | ` +
                `${params.downloadMbps}/${params.uploadMbps} Mbps | ${creds.ip}`);
        });
    }
    async crearQueueTypePcq(api, name, flow, isV7) {
        const existing = await api.write('/queue/type/print', [`?name=${name}`]);
        if (existing.length > 0)
            return;
        const classifier = flow === 'download' ? 'dst-address' : 'src-address';
        await api.write('/queue/type/add', [
            `=name=${name}`,
            `=kind=pcq`,
            `=pcq-classifier=${classifier}`,
            `=pcq-rate=0`,
            `=pcq-limit=50KiB`,
            `=pcq-total-limit=2000KiB`,
            ...(isV7 ? [`=pcq-dst-address-mask=32`, `=pcq-src-address-mask=32`] : []),
        ]);
    }
    async crearMangleRules(api, prefix, wanIface, isV7) {
        const rules = [
            {
                chain: 'forward', in: wanIface,
                action: 'mark-connection',
                newConn: `${prefix}-conn-down`,
                comment: `${prefix} - mark download connection`,
            },
            {
                chain: 'forward', in: wanIface,
                action: 'mark-packet',
                connMark: `${prefix}-conn-down`,
                newMark: `${prefix}-pkt-down`,
                comment: `${prefix} - mark download packets`,
            },
            {
                chain: 'forward', out: wanIface,
                action: 'mark-connection',
                newConn: `${prefix}-conn-up`,
                comment: `${prefix} - mark upload connection`,
            },
            {
                chain: 'forward', out: wanIface,
                action: 'mark-packet',
                connMark: `${prefix}-conn-up`,
                newMark: `${prefix}-pkt-up`,
                comment: `${prefix} - mark upload packets`,
            },
        ];
        for (const r of rules) {
            const checkArgs = [`?comment=${r.comment}`];
            const existing = await api.write('/ip/firewall/mangle/print', checkArgs);
            if (existing.length > 0)
                continue;
            const args = [
                `=chain=${r.chain}`,
                ...(r.in ? [`=in-interface=${r.in}`] : []),
                ...(r.out ? [`=out-interface=${r.out}`] : []),
                `=action=${r.action}`,
                ...(r.newConn ? [`=new-connection-mark=${r.newConn}`, `=passthrough=yes`] : []),
                ...(r.connMark ? [`=connection-mark=${r.connMark}`] : []),
                ...(r.newMark ? [`=new-packet-mark=${r.newMark}`, `=passthrough=no`] : []),
                `=comment=${r.comment}`,
            ];
            await api.write('/ip/firewall/mangle/add', args);
        }
    }
    async crearQueueTree(api, prefix, downloadMbps, uploadMbps, wanIface, isV7) {
        const padreExisting = await api.write('/queue/tree/print', [`?name=${prefix}-global`]);
        if (padreExisting.length === 0) {
            await api.write('/queue/tree/add', [
                `=name=${prefix}-global`,
                `=parent=global`,
                `=max-limit=${Math.max(downloadMbps, uploadMbps)}M`,
                `=queue=default`,
                `=comment=${prefix} - global queue tree`,
            ]);
        }
        const dlExisting = await api.write('/queue/tree/print', [`?name=${prefix}-download`]);
        if (dlExisting.length === 0) {
            await api.write('/queue/tree/add', [
                `=name=${prefix}-download`,
                `=parent=${prefix}-global`,
                `=packet-mark=${prefix}-pkt-down`,
                `=max-limit=${downloadMbps}M`,
                `=queue=${prefix}-pcq-down`,
                `=comment=${prefix} - PCQ download`,
            ]);
        }
        const ulExisting = await api.write('/queue/tree/print', [`?name=${prefix}-upload`]);
        if (ulExisting.length === 0) {
            await api.write('/queue/tree/add', [
                `=name=${prefix}-upload`,
                `=parent=${prefix}-global`,
                `=packet-mark=${prefix}-pkt-up`,
                `=max-limit=${uploadMbps}M`,
                `=queue=${prefix}-pcq-up`,
                `=comment=${prefix} - PCQ upload`,
            ]);
        }
    }
    async detectarInterfaceWan(api) {
        try {
            const routes = await api.write('/ip/route/print', ['?dst-address=0.0.0.0/0', '?!disabled']);
            if (routes.length > 0 && routes[0]['gateway']) {
                const gateway = routes[0]['gateway'];
                const neigh = await api.write('/ip/arp/print', [`?address=${gateway}`]);
                if (neigh.length > 0 && neigh[0]['interface']) {
                    return neigh[0]['interface'];
                }
            }
        }
        catch { }
        const ifaces = await api.write('/interface/print', ['?type=ether', '?!disabled']);
        const wan = ifaces.find((i) => /wan|internet|ether1|uplink/i.test(i.name || ''));
        return wan?.name || 'ether1';
    }
    async actualizarLimiteQueue(creds, name, downloadMbps, uploadMbps) {
        await this.pool.execute(creds, async (api) => {
            const queues = await api.write('/queue/simple/print', [`?name=${name}`]);
            if (queues.length === 0) {
                this.logger.warn(`Queue ${name} no existe en ${creds.ip}`);
                return;
            }
            await api.write('/queue/simple/set', [
                `=.id=${queues[0]['.id']}`,
                `=max-limit=${uploadMbps}M/${downloadMbps}M`,
            ]);
            this.logger.log(`Queue actualizada: ${name} | ${uploadMbps}/${downloadMbps} Mbps`);
        });
    }
    async getEstadisticasQueue(creds, name) {
        const queues = await this.pool.execute(creds, (api) => api.write('/queue/simple/print', [`?name=${name}`]));
        if (!queues.length)
            return null;
        const q = queues[0];
        return {
            bytesIn: parseInt(q['bytes'] || '0/0', 10) || 0,
            bytesOut: 0,
            packetsIn: parseInt(q['packets'] || '0/0', 10) || 0,
            packetsOut: 0,
        };
    }
};
exports.QueueService = QueueService;
exports.QueueService = QueueService = QueueService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool])
], QueueService);
//# sourceMappingURL=queue.service.js.map