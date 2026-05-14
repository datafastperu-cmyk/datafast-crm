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
var QueueTreeClienteService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueTreeClienteService = void 0;
const common_1 = require("@nestjs/common");
const connection_pool_service_1 = require("../../services/connection-pool.service");
const mangle_service_1 = require("./mangle.service");
let QueueTreeClienteService = QueueTreeClienteService_1 = class QueueTreeClienteService {
    constructor(pool, mangleSvc) {
        this.pool = pool;
        this.mangleSvc = mangleSvc;
        this.logger = new common_1.Logger(QueueTreeClienteService_1.name);
        this.PREFIX = 'fn-qt';
    }
    async crearQueueTreeCliente(creds, clienteId, config, wanIface) {
        const mangleResult = await this.mangleSvc.crearMangleCliente(creds, clienteId, config.targetIp, wanIface);
        await this.asegurarQueuesPadreGlobales(creds);
        const nombres = this.generarNombres(clienteId);
        return this.pool.execute(creds, async (api) => {
            let creadas = mangleResult.reglasCreadas;
            const padreExiste = await api.write('/queue/tree/print', [
                `?name=${nombres.padre}`,
            ]).then((r) => r.length > 0).catch(() => false);
            if (!padreExiste) {
                await api.write('/queue/tree/add', [
                    `=name=${nombres.padre}`,
                    `=parent=global`,
                    `=max-limit=${Math.max(config.downloadMbps, config.uploadMbps)}M`,
                    `=queue=default`,
                    `=priority=${config.prioridad}`,
                    `=comment=fn:cli:${clienteId}:padre`,
                ]);
                creadas++;
            }
            const downExiste = await api.write('/queue/tree/print', [
                `?name=${nombres.download}`,
            ]).then((r) => r.length > 0).catch(() => false);
            if (!downExiste) {
                const downArgs = [
                    `=name=${nombres.download}`,
                    `=parent=${nombres.padre}`,
                    `=packet-mark=${mangleResult.marcas.packetMarkDown}`,
                    `=max-limit=${config.downloadMbps}M`,
                    `=queue=default`,
                    `=priority=${config.prioridad}`,
                    `=comment=fn:cli:${clienteId}:down`,
                ];
                if (config.burstDownMbps && config.burstDownMbps > config.downloadMbps) {
                    downArgs.push(`=burst-limit=${config.burstDownMbps}M`, `=burst-threshold=${config.burstThreshDown || config.downloadMbps}M`, `=burst-time=${config.burstTiempoSeg || 8}`);
                }
                await api.write('/queue/tree/add', downArgs);
                creadas++;
            }
            else {
                const existing = await api.write('/queue/tree/print', [`?name=${nombres.download}`]);
                if (existing.length) {
                    await api.write('/queue/tree/set', [
                        `=.id=${existing[0]['.id']}`,
                        `=max-limit=${config.downloadMbps}M`,
                        `=priority=${config.prioridad}`,
                    ]);
                }
            }
            const upExiste = await api.write('/queue/tree/print', [
                `?name=${nombres.upload}`,
            ]).then((r) => r.length > 0).catch(() => false);
            if (!upExiste) {
                const upArgs = [
                    `=name=${nombres.upload}`,
                    `=parent=${nombres.padre}`,
                    `=packet-mark=${mangleResult.marcas.packetMarkUp}`,
                    `=max-limit=${config.uploadMbps}M`,
                    `=queue=default`,
                    `=priority=${config.prioridad}`,
                    `=comment=fn:cli:${clienteId}:up`,
                ];
                if (config.burstUpMbps && config.burstUpMbps > config.uploadMbps) {
                    upArgs.push(`=burst-limit=${config.burstUpMbps}M`, `=burst-threshold=${config.burstThreshUp || config.uploadMbps}M`, `=burst-time=${config.burstTiempoSeg || 8}`);
                }
                await api.write('/queue/tree/add', upArgs);
                creadas++;
            }
            else {
                const existing = await api.write('/queue/tree/print', [`?name=${nombres.upload}`]);
                if (existing.length) {
                    await api.write('/queue/tree/set', [
                        `=.id=${existing[0]['.id']}`,
                        `=max-limit=${config.uploadMbps}M`,
                        `=priority=${config.prioridad}`,
                    ]);
                }
            }
            this.logger.log(`Queue Tree cliente ${clienteId}: ` +
                `${config.downloadMbps}/${config.uploadMbps} Mbps | ` +
                `prioridad: ${config.prioridad} | ${creadas} items creados`);
            return { nombres, reglasCreadas: creadas };
        });
    }
    async actualizarVelocidad(creds, clienteId, downloadMbps, uploadMbps, prioridad) {
        const nombres = this.generarNombres(clienteId);
        const qtActualizado = await this.actualizarQueueTree(creds, nombres, downloadMbps, uploadMbps, prioridad);
        if (qtActualizado) {
            return { actualizado: true, metodo: 'queue_tree' };
        }
        const sqActualizado = await this.actualizarSimpleQueue(creds, clienteId, downloadMbps, uploadMbps);
        return { actualizado: sqActualizado, metodo: sqActualizado ? 'simple_queue' : 'no_encontrado' };
    }
    async actualizarQueueTree(creds, nombres, downloadMbps, uploadMbps, prioridad) {
        return this.pool.execute(creds, async (api) => {
            const downQ = await api.write('/queue/tree/print', [`?name=${nombres.download}`]);
            const upQ = await api.write('/queue/tree/print', [`?name=${nombres.upload}`]);
            if (!downQ.length && !upQ.length)
                return false;
            if (downQ.length) {
                await api.write('/queue/tree/set', [
                    `=.id=${downQ[0]['.id']}`,
                    `=max-limit=${downloadMbps}M`,
                    ...(prioridad ? [`=priority=${prioridad}`] : []),
                ]);
            }
            if (upQ.length) {
                await api.write('/queue/tree/set', [
                    `=.id=${upQ[0]['.id']}`,
                    `=max-limit=${uploadMbps}M`,
                    ...(prioridad ? [`=priority=${prioridad}`] : []),
                ]);
            }
            const padreQ = await api.write('/queue/tree/print', [`?name=${nombres.padre}`]);
            if (padreQ.length) {
                await api.write('/queue/tree/set', [
                    `=.id=${padreQ[0]['.id']}`,
                    `=max-limit=${Math.max(downloadMbps, uploadMbps)}M`,
                ]);
            }
            this.logger.log(`Queue Tree actualizada: ${nombres.download} | ` +
                `${downloadMbps}/${uploadMbps} Mbps`);
            return true;
        });
    }
    async actualizarSimpleQueue(creds, clienteId, downloadMbps, uploadMbps) {
        return this.pool.execute(creds, async (api) => {
            const queues = await api.write('/queue/simple/print', [
                `?comment~FibraNet:ClienteID:${clienteId}`,
            ]).catch(() => []);
            if (!queues.length)
                return false;
            for (const q of queues) {
                await api.write('/queue/simple/set', [
                    `=.id=${q['.id']}`,
                    `=max-limit=${uploadMbps}M/${downloadMbps}M`,
                ]);
            }
            this.logger.log(`Simple Queue actualizada para cliente ${clienteId}: ${uploadMbps}/${downloadMbps} Mbps`);
            return true;
        });
    }
    async eliminarQueueTreeCliente(creds, clienteId) {
        const nombres = this.generarNombres(clienteId);
        await this.pool.execute(creds, async (api) => {
            for (const nombre of [nombres.download, nombres.upload, nombres.padre]) {
                const q = await api.write('/queue/tree/print', [`?name=${nombre}`]).catch(() => []);
                if (q.length) {
                    await api.write('/queue/tree/remove', [`=.id=${q[0]['.id']}`]);
                }
            }
            this.logger.log(`Queue Tree eliminada: cliente ${clienteId}`);
        });
        await this.mangleSvc.eliminarMangleCliente(creds, clienteId);
    }
    async asegurarQueuesPadreGlobales(creds) {
        await this.pool.execute(creds, async (api) => {
            const globalDown = await api.write('/queue/tree/print', [`?name=fn-global-down`]).catch(() => []);
            if (!globalDown.length) {
                await api.write('/queue/tree/add', [
                    `=name=fn-global-down`,
                    `=parent=global`,
                    `=max-limit=1000M`,
                    `=queue=default`,
                    `=comment=fn:global:download`,
                ]);
            }
            const globalUp = await api.write('/queue/tree/print', [`?name=fn-global-up`]).catch(() => []);
            if (!globalUp.length) {
                await api.write('/queue/tree/add', [
                    `=name=fn-global-up`,
                    `=parent=global`,
                    `=max-limit=500M`,
                    `=queue=default`,
                    `=comment=fn:global:upload`,
                ]);
            }
        });
    }
    generarNombres(clienteId) {
        const shortId = clienteId.replace(/-/g, '').substring(0, 12);
        return {
            padre: `${this.PREFIX}-${shortId}`,
            download: `${this.PREFIX}-${shortId}-down`,
            upload: `${this.PREFIX}-${shortId}-up`,
        };
    }
    async listarQueueTreesFibranet(creds) {
        return this.pool.execute(creds, async (api) => {
            const all = await api.write('/queue/tree/print');
            return all.filter((q) => q.comment?.startsWith('fn:cli:'));
        });
    }
};
exports.QueueTreeClienteService = QueueTreeClienteService;
exports.QueueTreeClienteService = QueueTreeClienteService = QueueTreeClienteService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool,
        mangle_service_1.MangleService])
], QueueTreeClienteService);
//# sourceMappingURL=queue-tree-cliente.service.js.map