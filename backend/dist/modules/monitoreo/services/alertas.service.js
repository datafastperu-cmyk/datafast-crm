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
var AlertasService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertasService = exports.EVENTO_NODO_ONLINE = exports.EVENTO_NODO_OFFLINE = exports.EVENTO_ALERTA_RESUELTA = exports.EVENTO_ALERTA_NUEVA = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const typeorm_3 = require("@nestjs/typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const monitoreo_entity_1 = require("../entities/monitoreo.entity");
const whatsapp_service_1 = require("../../notificaciones/services/whatsapp.service");
exports.EVENTO_ALERTA_NUEVA = 'monitoreo.alerta.nueva';
exports.EVENTO_ALERTA_RESUELTA = 'monitoreo.alerta.resuelta';
exports.EVENTO_NODO_OFFLINE = 'monitoreo.nodo.offline';
exports.EVENTO_NODO_ONLINE = 'monitoreo.nodo.online';
let AlertasService = AlertasService_1 = class AlertasService {
    constructor(alertaRepo, configRepo, nodoRepo, whatsapp, events, ds) {
        this.alertaRepo = alertaRepo;
        this.configRepo = configRepo;
        this.nodoRepo = nodoRepo;
        this.whatsapp = whatsapp;
        this.events = events;
        this.ds = ds;
        this.logger = new common_1.Logger(AlertasService_1.name);
    }
    async evaluar(medicion) {
        const configs = await this.configRepo.find({
            where: [
                { nodoId: medicion.nodoId, metrica: medicion.metrica, activo: true },
                { empresaId: medicion.empresaId, nodoId: null, metrica: medicion.metrica, activo: true },
            ],
        });
        for (const config of configs) {
            await this.evaluarUmbral(medicion, config);
        }
    }
    async evaluarUmbral(medicion, config) {
        const valor = medicion.valorActual;
        let nivelNuevo = null;
        if (valor >= config.umbralCritical) {
            nivelNuevo = monitoreo_entity_1.NivelAlerta.CRITICAL;
        }
        else if (valor >= config.umbralWarning) {
            nivelNuevo = monitoreo_entity_1.NivelAlerta.WARNING;
        }
        const alertaExistente = await this.alertaRepo.findOne({
            where: {
                nodoId: medicion.nodoId,
                metrica: medicion.metrica,
                estado: monitoreo_entity_1.EstadoAlerta.ACTIVA,
            },
            order: { createdAt: 'DESC' },
        });
        if (nivelNuevo && !alertaExistente) {
            await this.crearAlerta({
                nodoId: medicion.nodoId,
                empresaId: medicion.empresaId,
                nodoNombre: medicion.nodoNombre,
                nivel: nivelNuevo,
                metrica: medicion.metrica,
                valorActual: valor,
                umbral: nivelNuevo === monitoreo_entity_1.NivelAlerta.CRITICAL ? config.umbralCritical : config.umbralWarning,
                config,
            });
        }
        else if (!nivelNuevo && alertaExistente) {
            await this.resolverAlerta(alertaExistente.id, 'Sistema — valor volvió a rango normal');
        }
    }
    async alertarNodoOffline(nodoId, empresaId, nodoNombre) {
        const alertaExistente = await this.alertaRepo.findOne({
            where: { nodoId, metrica: monitoreo_entity_1.MetricaAlerta.ESTADO_NODO, estado: monitoreo_entity_1.EstadoAlerta.ACTIVA },
        });
        if (alertaExistente)
            return;
        const alerta = await this.crearAlerta({
            nodoId,
            empresaId,
            nodoNombre,
            nivel: monitoreo_entity_1.NivelAlerta.CRITICAL,
            metrica: monitoreo_entity_1.MetricaAlerta.ESTADO_NODO,
            valorActual: 0,
            umbral: 1,
        });
        this.events.emit(exports.EVENTO_NODO_OFFLINE, {
            nodoId, empresaId, nodoNombre, alertaId: alerta?.id,
            timestamp: new Date().toISOString(),
        });
    }
    async alertarNodoOnline(nodoId, empresaId, nodoNombre) {
        const alertaOffline = await this.alertaRepo.findOne({
            where: { nodoId, metrica: monitoreo_entity_1.MetricaAlerta.ESTADO_NODO, estado: monitoreo_entity_1.EstadoAlerta.ACTIVA },
        });
        if (alertaOffline) {
            await this.resolverAlerta(alertaOffline.id, 'Nodo recuperado — online');
        }
        this.events.emit(exports.EVENTO_NODO_ONLINE, {
            nodoId, empresaId, nodoNombre,
            timestamp: new Date().toISOString(),
        });
    }
    async crearAlerta(params) {
        const mensaje = this.construirMensaje(params.metrica, params.valorActual, params.nivel);
        const alerta = this.alertaRepo.create({
            nodoId: params.nodoId,
            empresaId: params.empresaId,
            nodoNombre: params.nodoNombre,
            nivel: params.nivel,
            estado: monitoreo_entity_1.EstadoAlerta.ACTIVA,
            metrica: params.metrica,
            mensaje,
            detalle: `Valor: ${params.valorActual} | Umbral: ${params.umbral}`,
            valorActual: params.valorActual,
            umbral: params.umbral,
        });
        const saved = await this.alertaRepo.save(alerta);
        this.logger.warn(`🚨 ALERTA [${params.nivel.toUpperCase()}] ${params.nodoNombre}: ` +
            `${params.metrica} = ${params.valorActual} (umbral: ${params.umbral})`);
        this.events.emit(exports.EVENTO_ALERTA_NUEVA, {
            alerta: saved,
            empresaId: params.empresaId,
        });
        if (params.config?.notificarWhatsapp && params.config?.telefonoDestino) {
            this.whatsapp.enviar({
                telefono: params.config.telefonoDestino,
                tipo: 'onu_offline',
                variables: {
                    clienteNombre: params.nodoNombre,
                    fechaHora: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }),
                },
            }).catch((err) => this.logger.error(`WhatsApp alerta: ${err.message}`));
        }
        return saved;
    }
    async resolverAlerta(alertaId, motivo, resueltaPor) {
        const alerta = await this.alertaRepo.findOne({ where: { id: alertaId } });
        if (!alerta || alerta.estado !== monitoreo_entity_1.EstadoAlerta.ACTIVA)
            return;
        const ahora = new Date();
        const duracionMin = Math.floor((ahora.getTime() - new Date(alerta.createdAt).getTime()) / 60000);
        await this.alertaRepo.update(alertaId, {
            estado: monitoreo_entity_1.EstadoAlerta.RESUELTA,
            resueltaEn: ahora,
            resueltaPor: resueltaPor || 'sistema',
            duracionMinutos: duracionMin,
        });
        this.logger.log(`✅ Alerta resuelta [${duracionMin}min]: ${alerta.nodoNombre} | ${alerta.metrica}`);
        this.events.emit(exports.EVENTO_ALERTA_RESUELTA, {
            alertaId,
            nodoId: alerta.nodoId,
            empresaId: alerta.empresaId,
            nodoNombre: alerta.nodoNombre,
            metrica: alerta.metrica,
            duracionMin,
            timestamp: ahora.toISOString(),
        });
    }
    async getAlertasActivas(empresaId) {
        return this.alertaRepo.find({
            where: { empresaId, estado: monitoreo_entity_1.EstadoAlerta.ACTIVA },
            order: { nivel: 'ASC', createdAt: 'DESC' },
            take: 100,
        });
    }
    async getHistorialAlertas(empresaId, nodoId, limit = 50) {
        const qb = this.alertaRepo.createQueryBuilder('a')
            .where('a.empresa_id = :empresaId', { empresaId })
            .orderBy('a.created_at', 'DESC')
            .take(limit);
        if (nodoId)
            qb.andWhere('a.nodo_id = :nodoId', { nodoId });
        return qb.getMany();
    }
    async getResumenAlertas(empresaId) {
        const [activas, resueltasHoy] = await Promise.all([
            this.alertaRepo.createQueryBuilder('a')
                .select('a.nivel', 'nivel').addSelect('COUNT(*)', 'total')
                .where('a.empresa_id = :empresaId', { empresaId })
                .andWhere('a.estado = :estado', { estado: monitoreo_entity_1.EstadoAlerta.ACTIVA })
                .groupBy('a.nivel').getRawMany(),
            this.alertaRepo.createQueryBuilder('a')
                .where('a.empresa_id = :empresaId', { empresaId })
                .andWhere('a.estado = :estado', { estado: monitoreo_entity_1.EstadoAlerta.RESUELTA })
                .andWhere('a.resuelta_en >= CURRENT_DATE')
                .getCount(),
        ]);
        return {
            activas: activas.reduce((acc, r) => acc + parseInt(r.total), 0),
            criticas: parseInt(activas.find((r) => r.nivel === monitoreo_entity_1.NivelAlerta.CRITICAL)?.total || '0'),
            warnings: parseInt(activas.find((r) => r.nivel === monitoreo_entity_1.NivelAlerta.WARNING)?.total || '0'),
            resueltasHoy,
        };
    }
    construirMensaje(metrica, valor, nivel) {
        const textos = {
            [monitoreo_entity_1.MetricaAlerta.PING_LATENCIA]: `Alta latencia: ${valor.toFixed(1)}ms`,
            [monitoreo_entity_1.MetricaAlerta.PING_PERDIDA]: `Pérdida de paquetes: ${valor.toFixed(1)}%`,
            [monitoreo_entity_1.MetricaAlerta.CPU]: `CPU alta: ${valor.toFixed(1)}%`,
            [monitoreo_entity_1.MetricaAlerta.MEMORIA]: `Memoria alta: ${valor.toFixed(1)}%`,
            [monitoreo_entity_1.MetricaAlerta.TRAFICO_BAJADA]: `Tráfico bajada: ${this.formatBps(valor)}`,
            [monitoreo_entity_1.MetricaAlerta.TRAFICO_SUBIDA]: `Tráfico subida: ${this.formatBps(valor)}`,
            [monitoreo_entity_1.MetricaAlerta.TEMPERATURA]: `Temperatura alta: ${valor.toFixed(1)}°C`,
            [monitoreo_entity_1.MetricaAlerta.ESTADO_NODO]: `Nodo OFFLINE — sin respuesta`,
            [monitoreo_entity_1.MetricaAlerta.SESIONES_PPPOE]: `Sesiones PPPoE: ${valor}`,
            [monitoreo_entity_1.MetricaAlerta.SENAL_ONU]: `Señal ONU baja: ${valor.toFixed(2)} dBm`,
        };
        return `[${nivel.toUpperCase()}] ${textos[metrica] || metrica}`;
    }
    formatBps(bps) {
        if (bps >= 1e9)
            return `${(bps / 1e9).toFixed(2)} Gbps`;
        if (bps >= 1e6)
            return `${(bps / 1e6).toFixed(2)} Mbps`;
        if (bps >= 1e3)
            return `${(bps / 1e3).toFixed(2)} Kbps`;
        return `${bps} bps`;
    }
};
exports.AlertasService = AlertasService;
exports.AlertasService = AlertasService = AlertasService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_3.InjectRepository)(monitoreo_entity_1.Alerta)),
    __param(1, (0, typeorm_3.InjectRepository)(monitoreo_entity_1.ConfiguracionAlerta)),
    __param(2, (0, typeorm_3.InjectRepository)(monitoreo_entity_1.Nodo)),
    __param(5, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        whatsapp_service_1.WhatsAppService,
        event_emitter_1.EventEmitter2,
        typeorm_2.DataSource])
], AlertasService);
//# sourceMappingURL=alertas.service.js.map