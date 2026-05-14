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
var MonitoreoScheduler_1, MonitoreoWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoreoWorker = exports.MonitoreoScheduler = exports.JOB_DASHBOARD = exports.JOB_PING_BATCH = exports.JOB_SNMP_NODO = exports.JOB_PING_NODO = exports.MONITOREO_QUEUE = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const bull_2 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const typeorm_3 = require("@nestjs/typeorm");
const typeorm_4 = require("typeorm");
const ping_service_1 = require("./services/ping.service");
const snmp_service_1 = require("./services/snmp.service");
const alertas_service_1 = require("./services/alertas.service");
const monitoreo_gateway_1 = require("./gateways/monitoreo.gateway");
const monitoreo_entity_1 = require("./entities/monitoreo.entity");
exports.MONITOREO_QUEUE = 'monitoreo';
exports.JOB_PING_NODO = 'ping-nodo';
exports.JOB_SNMP_NODO = 'snmp-nodo';
exports.JOB_PING_BATCH = 'ping-batch';
exports.JOB_DASHBOARD = 'broadcast-dashboard';
let MonitoreoScheduler = MonitoreoScheduler_1 = class MonitoreoScheduler {
    constructor(queue, nodoRepo) {
        this.queue = queue;
        this.nodoRepo = nodoRepo;
        this.logger = new common_1.Logger(MonitoreoScheduler_1.name);
    }
    async schedulePing() {
        const nodos = await this.nodoRepo.find({
            where: { activo: true, pingHabilitado: true },
        });
        if (!nodos.length)
            return;
        const porEmpresa = new Map();
        for (const n of nodos) {
            if (!porEmpresa.has(n.empresaId))
                porEmpresa.set(n.empresaId, []);
            porEmpresa.get(n.empresaId).push(n);
        }
        for (const [empresaId, nodosEmpresa] of porEmpresa.entries()) {
            await this.queue.add(exports.JOB_PING_BATCH, {
                empresaId,
                nodos: nodosEmpresa.map((n) => ({
                    id: n.id,
                    ip: n.ipMonitoreo,
                    nombre: n.nombre,
                    tipo: n.tipo,
                    pingTimeoutMs: n.pingTimeoutMs,
                    pingReintentos: n.pingReintentos,
                    estadoActual: n.estado,
                    alertasHabilitadas: n.alertasHabilitadas,
                })),
            }, {
                removeOnComplete: true,
                removeOnFail: 50,
                attempts: 1,
            });
        }
        this.logger.debug(`Ping encolado: ${nodos.length} nodos en ${porEmpresa.size} empresas`);
    }
    async scheduleSnmp() {
        const nodos = await this.nodoRepo.find({
            where: { activo: true, snmpHabilitado: true },
        });
        for (const nodo of nodos) {
            await this.queue.add(exports.JOB_SNMP_NODO, {
                nodoId: nodo.id,
                empresaId: nodo.empresaId,
                nombre: nodo.nombre,
                ip: nodo.ipMonitoreo,
                community: nodo.snmpCommunity,
                version: nodo.snmpVersion,
                ifIndex: nodo.snmpInterfaceIndex,
                alertasHabilitadas: nodo.alertasHabilitadas,
            }, {
                removeOnComplete: true,
                removeOnFail: 50,
                attempts: 2,
                backoff: { type: 'fixed', delay: 30_000 },
                delay: nodos.indexOf(nodo) * 500,
            });
        }
    }
    async scheduleDashboard() {
        await this.queue.add(exports.JOB_DASHBOARD, {}, {
            removeOnComplete: true,
            attempts: 1,
        });
    }
};
exports.MonitoreoScheduler = MonitoreoScheduler;
__decorate([
    (0, schedule_1.Cron)('*/60 * * * * *', { timeZone: 'America/Lima', name: 'ping-ciclo' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MonitoreoScheduler.prototype, "schedulePing", null);
__decorate([
    (0, schedule_1.Cron)('0 */5 * * * *', { timeZone: 'America/Lima', name: 'snmp-ciclo' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MonitoreoScheduler.prototype, "scheduleSnmp", null);
__decorate([
    (0, schedule_1.Cron)('*/30 * * * * *', { timeZone: 'America/Lima' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MonitoreoScheduler.prototype, "scheduleDashboard", null);
exports.MonitoreoScheduler = MonitoreoScheduler = MonitoreoScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_2.InjectQueue)(exports.MONITOREO_QUEUE)),
    __param(1, (0, typeorm_1.InjectRepository)(monitoreo_entity_1.Nodo)),
    __metadata("design:paramtypes", [Object, typeorm_2.Repository])
], MonitoreoScheduler);
let MonitoreoWorker = MonitoreoWorker_1 = class MonitoreoWorker {
    constructor(pingSvc, snmpSvc, alertasSvc, gateway, nodoRepo, medicionRepo, ds) {
        this.pingSvc = pingSvc;
        this.snmpSvc = snmpSvc;
        this.alertasSvc = alertasSvc;
        this.gateway = gateway;
        this.nodoRepo = nodoRepo;
        this.medicionRepo = medicionRepo;
        this.ds = ds;
        this.logger = new common_1.Logger(MonitoreoWorker_1.name);
    }
    async processPingBatch(job) {
        const { empresaId, nodos } = job.data;
        const inicio = Date.now();
        const ips = nodos.map((n) => n.ip);
        const resultados = await this.pingSvc.pingBulk(ips, 3, 3000, 15);
        const updates = [];
        for (const nodo of nodos) {
            const ping = resultados.get(nodo.ip);
            if (!ping)
                continue;
            updates.push(this.procesarResultadoPing(nodo, ping, empresaId));
        }
        await Promise.allSettled(updates);
        const duracion = Date.now() - inicio;
        this.logger.debug(`Ping batch ${empresaId}: ${nodos.length} nodos en ${duracion}ms`);
    }
    async procesarResultadoPing(nodo, ping, empresaId) {
        const ahora = new Date();
        const nuevoEstado = ping.alive ? monitoreo_entity_1.EstadoNodo.ONLINE : monitoreo_entity_1.EstadoNodo.OFFLINE;
        const estadoCambio = nodo.estadoActual !== nuevoEstado;
        const updateData = {
            estado: nuevoEstado,
            ultimoPing: ahora,
            latenciaMs: ping.latencyMs ?? undefined,
            perdidaPct: ping.lossPerct,
        };
        if (estadoCambio) {
            updateData.estadoDesde = ahora;
        }
        await this.nodoRepo.update(nodo.id, updateData);
        await this.medicionRepo.save(this.medicionRepo.create({
            nodoId: nodo.id,
            empresaId,
            timestamp: ahora,
            latenciaMs: ping.latencyMs ?? undefined,
            perdidaPct: ping.lossPerct,
            online: ping.alive,
        }));
        if (estadoCambio && nodo.alertasHabilitadas) {
            if (nuevoEstado === monitoreo_entity_1.EstadoNodo.OFFLINE) {
                this.logger.warn(`🔴 NODO OFFLINE: ${nodo.nombre} (${nodo.ip})`);
                await this.alertasSvc.alertarNodoOffline(nodo.id, empresaId, nodo.nombre);
            }
            else {
                this.logger.log(`🟢 NODO ONLINE: ${nodo.nombre} (${nodo.ip})`);
                await this.alertasSvc.alertarNodoOnline(nodo.id, empresaId, nodo.nombre);
            }
        }
        if (nodo.alertasHabilitadas && ping.alive) {
            if (ping.avg !== null && ping.avg > 0) {
                await this.alertasSvc.evaluar({
                    nodoId: nodo.id,
                    empresaId,
                    nodoNombre: nodo.nombre,
                    metrica: monitoreo_entity_1.MetricaAlerta.PING_LATENCIA,
                    valorActual: ping.avg,
                });
            }
            if (ping.lossPerct > 0) {
                await this.alertasSvc.evaluar({
                    nodoId: nodo.id,
                    empresaId,
                    nodoNombre: nodo.nombre,
                    metrica: monitoreo_entity_1.MetricaAlerta.PING_PERDIDA,
                    valorActual: ping.lossPerct,
                });
            }
        }
        this.gateway.broadcastMedicion(empresaId, {
            nodoId: nodo.id,
            nodoNombre: nodo.nombre,
            estado: nuevoEstado,
            latenciaMs: ping.latencyMs,
            perdidaPct: ping.lossPerct,
            timestamp: ahora.toISOString(),
        });
    }
    async processSnmpNodo(job) {
        const { nodoId, empresaId, nombre, ip, community, version, ifIndex, alertasHabilitadas } = job.data;
        try {
            const [metricas, trafico] = await Promise.all([
                this.snmpSvc.getSystemInfo(ip, community, version, true),
                ifIndex
                    ? Promise.resolve(null)
                    : Promise.resolve(null),
            ]);
            const ahora = new Date();
            const updateData = {};
            if (metricas.cpuPct !== undefined)
                updateData.cpuUsoPct = metricas.cpuPct;
            if (metricas.memoriaPct !== undefined)
                updateData.memoriaUsoPct = metricas.memoriaPct;
            if (metricas.temperatura !== undefined)
                updateData.temperaturaC = metricas.temperatura;
            if (trafico) {
                updateData.traficoRxBps = trafico.rxBps;
                updateData.traficoTxBps = trafico.txBps;
            }
            await this.nodoRepo.update(nodoId, updateData);
            await this.medicionRepo.update({ nodoId }, {
                cpuPct: metricas.cpuPct,
                memoriaPct: metricas.memoriaPct,
                temperaturaC: metricas.temperatura,
                traficoRxBps: trafico?.rxBps ? Number(trafico.rxBps) : undefined,
                traficoTxBps: trafico?.txBps ? Number(trafico.txBps) : undefined,
            });
            if (alertasHabilitadas) {
                const metricsAEvaluar = [
                    { metrica: monitoreo_entity_1.MetricaAlerta.CPU, valor: metricas.cpuPct },
                    { metrica: monitoreo_entity_1.MetricaAlerta.MEMORIA, valor: metricas.memoriaPct },
                    { metrica: monitoreo_entity_1.MetricaAlerta.TEMPERATURA, valor: metricas.temperatura },
                    { metrica: monitoreo_entity_1.MetricaAlerta.TRAFICO_BAJADA, valor: trafico?.rxBps },
                    { metrica: monitoreo_entity_1.MetricaAlerta.TRAFICO_SUBIDA, valor: trafico?.txBps },
                ];
                for (const { metrica, valor } of metricsAEvaluar) {
                    if (valor !== undefined && valor !== null) {
                        await this.alertasSvc.evaluar({ nodoId, empresaId, nodoNombre: nombre, metrica, valorActual: valor });
                    }
                }
            }
            this.gateway.broadcastMedicion(empresaId, {
                nodoId,
                nodoNombre: nombre,
                estado: monitoreo_entity_1.EstadoNodo.ONLINE,
                latenciaMs: null,
                perdidaPct: 0,
                cpuPct: metricas.cpuPct,
                memoriaPct: metricas.memoriaPct,
                traficoRxBps: trafico?.rxBps,
                traficoTxBps: trafico?.txBps,
                temperatura: metricas.temperatura,
                timestamp: ahora.toISOString(),
            });
            this.logger.debug(`SNMP ${nombre} (${ip}): CPU=${metricas.cpuPct}% | ` +
                `MEM=${metricas.memoriaPct}% | ` +
                `RX=${trafico ? (trafico.rxBps / 1e6).toFixed(2) + 'Mbps' : 'N/A'}`);
        }
        catch (err) {
            this.logger.warn(`SNMP ${nombre} (${ip}): ${err.message}`);
        }
    }
    async processDashboard(_job) {
        try {
            const resumen = await this.ds.query(`
        SELECT
          n.empresa_id,
          COUNT(*) FILTER (WHERE n.estado = 'online')  AS online,
          COUNT(*) FILTER (WHERE n.estado = 'offline') AS offline,
          COUNT(*) FILTER (WHERE n.estado = 'degradado') AS degradado,
          COUNT(*)                                      AS total,
          AVG(n.latencia_ms) FILTER (WHERE n.estado = 'online' AND n.latencia_ms IS NOT NULL) AS latencia_avg,
          SUM(n.trafico_rx_bps) AS total_rx,
          SUM(n.trafico_tx_bps) AS total_tx,
          SUM(n.sesiones_pppoe) AS total_sesiones
        FROM nodos n
        WHERE n.activo = true AND n.deleted_at IS NULL
        GROUP BY n.empresa_id
      `);
            for (const row of resumen) {
                this.gateway.broadcastDashboard(row.empresa_id, {
                    online: parseInt(row.online || '0', 10),
                    offline: parseInt(row.offline || '0', 10),
                    degradado: parseInt(row.degradado || '0', 10),
                    total: parseInt(row.total || '0', 10),
                    latenciaAvg: parseFloat(row.latencia_avg || '0'),
                    totalRxBps: parseInt(row.total_rx || '0', 10),
                    totalTxBps: parseInt(row.total_tx || '0', 10),
                    totalSesiones: parseInt(row.total_sesiones || '0', 10),
                    timestamp: new Date().toISOString(),
                });
            }
        }
        catch (err) {
            this.logger.error(`Dashboard broadcast: ${err.message}`);
        }
    }
    onFailed(job, error) {
        this.logger.error(`Job ${job.name} #${job.id} falló: ${error.message}`);
    }
};
exports.MonitoreoWorker = MonitoreoWorker;
__decorate([
    (0, bull_1.Process)(exports.JOB_PING_BATCH),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoWorker.prototype, "processPingBatch", null);
__decorate([
    (0, bull_1.Process)(exports.JOB_SNMP_NODO),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoWorker.prototype, "processSnmpNodo", null);
__decorate([
    (0, bull_1.Process)(exports.JOB_DASHBOARD),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MonitoreoWorker.prototype, "processDashboard", null);
__decorate([
    (0, bull_1.OnQueueFailed)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Error]),
    __metadata("design:returntype", void 0)
], MonitoreoWorker.prototype, "onFailed", null);
exports.MonitoreoWorker = MonitoreoWorker = MonitoreoWorker_1 = __decorate([
    (0, bull_1.Processor)(exports.MONITOREO_QUEUE),
    __param(4, (0, typeorm_1.InjectRepository)(monitoreo_entity_1.Nodo)),
    __param(5, (0, typeorm_1.InjectRepository)(monitoreo_entity_1.MedicionNodo)),
    __param(6, (0, typeorm_3.InjectDataSource)()),
    __metadata("design:paramtypes", [ping_service_1.PingService,
        snmp_service_1.SnmpService,
        alertas_service_1.AlertasService,
        monitoreo_gateway_1.MonitoreoGateway,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_4.DataSource])
], MonitoreoWorker);
//# sourceMappingURL=monitoreo.worker.js.map