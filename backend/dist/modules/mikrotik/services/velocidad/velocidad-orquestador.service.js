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
var VelocidadOrquestador_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VelocidadOrquestador = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const connection_pool_service_1 = require("../../services/connection-pool.service");
const velocidad_service_1 = require("./velocidad.service");
const mangle_service_1 = require("./mangle.service");
const queue_tree_cliente_service_1 = require("./queue-tree-cliente.service");
const queue_service_1 = require("../../services/queue.service");
let VelocidadOrquestador = VelocidadOrquestador_1 = class VelocidadOrquestador {
    constructor(pool, velocidadSvc, mangleSvc, qtClienteSvc, queueSvc, ds) {
        this.pool = pool;
        this.velocidadSvc = velocidadSvc;
        this.mangleSvc = mangleSvc;
        this.qtClienteSvc = qtClienteSvc;
        this.queueSvc = queueSvc;
        this.ds = ds;
        this.logger = new common_1.Logger(VelocidadOrquestador_1.name);
    }
    async aplicarVelocidad(params) {
        const { routerCreds: creds, clienteId } = params;
        try {
            const capacidad = await this.velocidadSvc.detectarCapacidad(creds);
            const estrategia = this.velocidadSvc.decidirEstrategia(params.tipoQueuePlan, capacidad, 0);
            this.logger.log(`Aplicando velocidad cliente ${clienteId}: ` +
                `${params.downloadMbps}/${params.uploadMbps} Mbps | ` +
                `estrategia: ${estrategia} | router: ${creds.ip}`);
            const config = this.velocidadSvc.construirConfig({
                nombreCliente: params.usuarioPppoe,
                ipAsignada: params.ipAsignada,
                downloadMbps: params.downloadMbps,
                uploadMbps: params.uploadMbps,
                burstDownMbps: params.burstDownMbps,
                burstUpMbps: params.burstUpMbps,
                burstTiempoSeg: params.burstTiempoSeg,
                tipoPlan: params.tipoPlan,
                estrategia,
            });
            let resultado;
            switch (estrategia) {
                case velocidad_service_1.EstrategiaQueue.QUEUE_TREE: {
                    const qt = await this.qtClienteSvc.crearQueueTreeCliente(creds, clienteId, config, params.wanIface);
                    resultado = {
                        estrategia,
                        nombreQueue: qt.nombres.padre,
                        reglasCreadas: qt.reglasCreadas,
                        exitoso: true,
                        detalle: `Queue Tree + Mangle: ${qt.reglasCreadas} reglas en ${creds.ip}`,
                    };
                    break;
                }
                case velocidad_service_1.EstrategiaQueue.PCQ_GLOBAL: {
                    const tienePcq = await this.queueSvc.tienePcqConfigurado(creds);
                    if (!tienePcq) {
                        await this.queueSvc.configurarPcqCompleto(creds, {
                            namePrefix: 'fibranet',
                            downloadMbps: params.downloadMbps * 20,
                            uploadMbps: params.uploadMbps * 20,
                        });
                    }
                    resultado = {
                        estrategia,
                        reglasCreadas: tienePcq ? 0 : 6,
                        exitoso: true,
                        detalle: `PCQ global activo en ${creds.ip} — cliente controlado por flujo`,
                    };
                    break;
                }
                case velocidad_service_1.EstrategiaQueue.SIN_LIMITE: {
                    resultado = {
                        estrategia,
                        reglasCreadas: 0,
                        exitoso: true,
                        detalle: 'Plan sin límite de velocidad — sin queue aplicada',
                    };
                    break;
                }
                default: {
                    const queueId = await this.queueSvc.crearSimpleQueue(creds, {
                        name: params.usuarioPppoe,
                        target: `${params.ipAsignada}/32`,
                        maxLimitDown: params.downloadMbps,
                        maxLimitUp: params.uploadMbps,
                        burstLimitDown: params.burstDownMbps,
                        burstLimitUp: params.burstUpMbps,
                        burstTimeDown: params.burstTiempoSeg,
                        burstTimeUp: params.burstTiempoSeg,
                        burstThreshDown: params.burstDownMbps
                            ? Math.round(params.downloadMbps * 0.8)
                            : undefined,
                        burstThreshUp: params.burstUpMbps
                            ? Math.round(params.uploadMbps * 0.8)
                            : undefined,
                        comment: `FibraNet:ClienteID:${clienteId}`,
                    });
                    resultado = {
                        estrategia,
                        nombreQueue: params.usuarioPppoe,
                        reglasCreadas: 1,
                        exitoso: true,
                        detalle: `Simple Queue: ${params.usuarioPppoe} | ${params.uploadMbps}M/${params.downloadMbps}M`,
                    };
                }
            }
            this.logger.log(`Velocidad aplicada: ${resultado.detalle}`);
            return resultado;
        }
        catch (error) {
            this.logger.error(`Error aplicando velocidad cliente ${clienteId} en ${params.routerCreds.ip}: ${error.message}`);
            return {
                estrategia: velocidad_service_1.EstrategiaQueue.SIMPLE_QUEUE,
                reglasCreadas: 0,
                exitoso: false,
                detalle: `Error: ${error.message}`,
            };
        }
    }
    async cambiarVelocidadPlan(creds, clienteId, usuarioPppoe, downloadMbps, uploadMbps, prioridad) {
        this.logger.log(`Cambio de velocidad plan: cliente ${clienteId} → ` +
            `${downloadMbps}/${uploadMbps} Mbps en ${creds.ip}`);
        const qtResult = await this.qtClienteSvc.actualizarVelocidad(creds, clienteId, downloadMbps, uploadMbps, prioridad);
        if (qtResult.actualizado) {
            return {
                actualizado: true,
                metodo: qtResult.metodo,
                detalle: `Velocidad actualizada vía ${qtResult.metodo}: ${downloadMbps}/${uploadMbps} Mbps`,
            };
        }
        try {
            await this.queueSvc.actualizarLimiteQueue(creds, usuarioPppoe, downloadMbps, uploadMbps);
            return {
                actualizado: true,
                metodo: 'simple_queue',
                detalle: `Simple Queue ${usuarioPppoe} actualizada: ${downloadMbps}/${uploadMbps} Mbps`,
            };
        }
        catch (err) {
            return {
                actualizado: false,
                metodo: 'no_encontrado',
                detalle: `No se encontró queue para el cliente ${clienteId}: ${err.message}`,
            };
        }
    }
    async sincronizarVelocidades(creds, routerId) {
        this.logger.log(`Sincronizando velocidades: router ${routerId} (${creds.ip})`);
        const resultado = {
            routerId,
            procesados: 0,
            actualizados: 0,
            errores: 0,
            detalles: [],
        };
        try {
            const contratos = await this.ds.query(`
        SELECT
          co.id           AS contrato_id,
          co.usuario_pppoe,
          co.ip_asignada,
          co.cliente_id,
          pl.velocidad_bajada  AS download_mbps,
          pl.velocidad_subida  AS upload_mbps,
          pl.tipo_queue,
          pl.tipo             AS tipo_plan,
          pl.nombre           AS plan_nombre
        FROM contratos co
        JOIN planes pl ON pl.id = co.plan_id
        WHERE co.router_id = $1
          AND co.estado IN ('activo', 'prorroga')
          AND co.deleted_at IS NULL
          AND co.usuario_pppoe IS NOT NULL
          AND co.ip_asignada IS NOT NULL
      `, [routerId]);
            resultado.procesados = contratos.length;
            if (!contratos.length) {
                this.logger.log(`Sin contratos activos para router ${routerId}`);
                return resultado;
            }
            const planesPorQueue = new Map();
            for (const c of contratos) {
                planesPorQueue.set(c.usuario_pppoe, {
                    downloadMbps: c.download_mbps,
                    uploadMbps: c.upload_mbps,
                });
            }
            const discrepancias = await this.velocidadSvc.listarDiscrepancias(creds, planesPorQueue);
            this.logger.log(`Router ${creds.ip}: ${contratos.length} contratos, ` +
                `${discrepancias.length} discrepancias encontradas`);
            for (const disc of discrepancias) {
                const contrato = contratos.find((c) => c.usuario_pppoe === disc.nombre);
                if (!contrato)
                    continue;
                try {
                    await this.queueSvc.actualizarLimiteQueue(creds, disc.nombre, parseInt(contrato.download_mbps, 10), parseInt(contrato.upload_mbps, 10));
                    resultado.actualizados++;
                    resultado.detalles.push({
                        clienteId: contrato.cliente_id,
                        resultado: `${disc.nombre}: ${disc.actual} → ${disc.esperado}`,
                    });
                }
                catch (err) {
                    resultado.errores++;
                    resultado.detalles.push({
                        clienteId: contrato.cliente_id,
                        resultado: 'error',
                        error: err.message,
                    });
                }
            }
            const contratosQT = contratos.filter((c) => c.tipo_queue === 'queue_tree' || c.tipo_queue === 'pcq');
            for (const c of contratosQT) {
                try {
                    const qtResult = await this.qtClienteSvc.actualizarVelocidad(creds, c.cliente_id, parseInt(c.download_mbps, 10), parseInt(c.upload_mbps, 10));
                    if (qtResult.actualizado) {
                        resultado.actualizados++;
                        resultado.detalles.push({
                            clienteId: c.cliente_id,
                            resultado: `Queue Tree actualizada: ${c.download_mbps}/${c.upload_mbps} Mbps`,
                        });
                    }
                }
                catch (err) {
                    resultado.errores++;
                    resultado.detalles.push({
                        clienteId: c.cliente_id,
                        resultado: 'error',
                        error: err.message,
                    });
                }
            }
        }
        catch (err) {
            this.logger.error(`Error en sincronización masiva ${routerId}: ${err.message}`);
            resultado.errores++;
        }
        this.logger.log(`Sincronización completada: ${resultado.actualizados} actualizados, ` +
            `${resultado.errores} errores de ${resultado.procesados} contratos`);
        return resultado;
    }
    async eliminarVelocidadCliente(creds, clienteId, usuarioPppoe) {
        await this.qtClienteSvc.eliminarQueueTreeCliente(creds, clienteId).catch((err) => this.logger.warn(`No se pudo eliminar Queue Tree ${clienteId}: ${err.message}`));
        await this.queueSvc.eliminarSimpleQueue(creds, usuarioPppoe).catch((err) => this.logger.warn(`No se pudo eliminar Simple Queue ${usuarioPppoe}: ${err.message}`));
        this.logger.log(`Queues eliminadas: cliente ${clienteId} (${usuarioPppoe}) en ${creds.ip}`);
    }
};
exports.VelocidadOrquestador = VelocidadOrquestador;
exports.VelocidadOrquestador = VelocidadOrquestador = VelocidadOrquestador_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(5, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [connection_pool_service_1.RouterConnectionPool,
        velocidad_service_1.VelocidadService,
        mangle_service_1.MangleService,
        queue_tree_cliente_service_1.QueueTreeClienteService,
        queue_service_1.QueueService,
        typeorm_2.DataSource])
], VelocidadOrquestador);
//# sourceMappingURL=velocidad-orquestador.service.js.map