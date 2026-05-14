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
var VelocidadService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VelocidadService = exports.EstrategiaQueue = void 0;
const common_1 = require("@nestjs/common");
const connection_pool_service_1 = require("../../services/connection-pool.service");
var EstrategiaQueue;
(function (EstrategiaQueue) {
    EstrategiaQueue["SIMPLE_QUEUE"] = "simple_queue";
    EstrategiaQueue["QUEUE_TREE"] = "queue_tree";
    EstrategiaQueue["PCQ_GLOBAL"] = "pcq_global";
    EstrategiaQueue["SIN_LIMITE"] = "sin_limite";
})(EstrategiaQueue || (exports.EstrategiaQueue = EstrategiaQueue = {}));
let VelocidadService = VelocidadService_1 = class VelocidadService {
    constructor(pool) {
        this.pool = pool;
        this.logger = new common_1.Logger(VelocidadService_1.name);
    }
    async detectarCapacidad(creds) {
        return this.pool.execute(creds, async (api) => {
            const [queueTypes, simpleQueues, queueTrees, recursos, sesiones,] = await Promise.all([
                api.write('/queue/type/print').catch(() => []),
                api.write('/queue/simple/print').catch(() => []),
                api.write('/queue/tree/print').catch(() => []),
                api.write('/system/resource/print').catch(() => [{}]),
                api.write('/ppp/active/print').catch(() => []),
            ]);
            const tienePcq = queueTypes.some((t) => t.kind === 'pcq');
            const res = recursos[0] || {};
            const freeMem = parseInt(res['free-memory'] || '0', 10);
            const totMem = parseInt(res['total-memory'] || '1', 10);
            return {
                tieneSimpleQueue: true,
                tieneQueueTree: true,
                tienePcq,
                totalQueues: simpleQueues.length + queueTrees.length,
                sesionesActivas: sesiones.length,
                cpuLoad: parseInt(res['cpu-load'] || '0', 10),
                memoryUsePct: Math.round((1 - freeMem / totMem) * 100),
                versionRos: res['version'] || '',
            };
        });
    }
    decidirEstrategia(tipoQueuePlan, capacidad, totalClientes) {
        if (tipoQueuePlan === 'sin_limite') {
            return EstrategiaQueue.SIN_LIMITE;
        }
        if (tipoQueuePlan === 'pcq') {
            return capacidad.tienePcq
                ? EstrategiaQueue.PCQ_GLOBAL
                : EstrategiaQueue.QUEUE_TREE;
        }
        if (tipoQueuePlan === 'queue_tree') {
            return EstrategiaQueue.QUEUE_TREE;
        }
        if (capacidad.cpuLoad > 85) {
            this.logger.warn(`Router con CPU alta (${capacidad.cpuLoad}%) — simple queue puede afectar rendimiento`);
        }
        return EstrategiaQueue.SIMPLE_QUEUE;
    }
    construirConfig(params) {
        const prioridades = {
            dedicado: 1,
            empresarial: 3,
            residencial: 5,
            prepago: 7,
        };
        const prioridad = prioridades[params.tipoPlan] ?? 5;
        const burstThreshDown = params.burstDownMbps
            ? Math.round(params.downloadMbps * 0.8)
            : undefined;
        const burstThreshUp = params.burstUpMbps
            ? Math.round(params.uploadMbps * 0.8)
            : undefined;
        return {
            estrategia: params.estrategia,
            downloadMbps: params.downloadMbps,
            uploadMbps: params.uploadMbps,
            burstDownMbps: params.burstDownMbps,
            burstUpMbps: params.burstUpMbps,
            burstTiempoSeg: params.burstTiempoSeg ?? 8,
            prioridad,
            nombreQueue: params.nombreCliente,
            targetIp: params.ipAsignada,
            burstThreshDown,
            burstThreshUp,
        };
    }
    async necesitaActualizacion(creds, nombreQueue, downloadMbps, uploadMbps) {
        return this.pool.execute(creds, async (api) => {
            const queues = await api.write('/queue/simple/print', [`?name=${nombreQueue}`]);
            if (!queues.length) {
                return { necesita: true };
            }
            const maxLimit = queues[0]['max-limit'] || '0/0';
            const [upStr, downStr] = maxLimit.split('/');
            const upMbps = this.parseMikrotikRate(upStr);
            const downMbps = this.parseMikrotikRate(downStr);
            const discrepancia = Math.abs(upMbps - uploadMbps) > 0.1
                || Math.abs(downMbps - downloadMbps) > 0.1;
            return { necesita: discrepancia, maxLimitActual: maxLimit };
        });
    }
    async listarDiscrepancias(creds, planesPorQueue) {
        const queues = await this.pool.execute(creds, (api) => api.write('/queue/simple/print'));
        const discrepancias = [];
        for (const queue of queues) {
            const plan = planesPorQueue.get(queue.name);
            if (!plan)
                continue;
            const maxLimit = queue['max-limit'] || '0/0';
            const [upStr, downStr] = maxLimit.split('/');
            const upMbps = this.parseMikrotikRate(upStr);
            const downMbps = this.parseMikrotikRate(downStr);
            if (Math.abs(upMbps - plan.uploadMbps) > 0.1 ||
                Math.abs(downMbps - plan.downloadMbps) > 0.1) {
                discrepancias.push({
                    nombre: queue.name,
                    actual: maxLimit,
                    esperado: `${plan.uploadMbps}M/${plan.downloadMbps}M`,
                });
            }
        }
        return discrepancias;
    }
    parseMikrotikRate(rateStr) {
        if (!rateStr)
            return 0;
        const str = rateStr.trim().toUpperCase();
        if (str.endsWith('G'))
            return parseFloat(str) * 1000;
        if (str.endsWith('M'))
            return parseFloat(str);
        if (str.endsWith('K'))
            return parseFloat(str) / 1000;
        return parseFloat(str) / 1_000_000;
    }
    formatearTasa(mbps) {
        if (mbps >= 1000)
            return `${mbps / 1000}G`;
        if (mbps < 1)
            return `${Math.round(mbps * 1000)}K`;
        return `${mbps}M`;
    }
};
exports.VelocidadService = VelocidadService;
exports.VelocidadService = VelocidadService = VelocidadService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool])
], VelocidadService);
//# sourceMappingURL=velocidad.service.js.map