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
var MikrotikService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MikrotikService = exports.EVENT_CLIENTE_REACTIVADO = exports.EVENT_CLIENTE_SUSPENDIDO = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const typeorm_3 = require("@nestjs/typeorm");
const typeorm_4 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const router_entity_1 = require("./entities/router.entity");
const connection_pool_service_1 = require("./services/connection-pool.service");
const pppoe_service_1 = require("./services/pppoe.service");
const queue_service_1 = require("./services/queue.service");
const firewall_service_1 = require("./services/firewall.service");
const interface_service_1 = require("./services/interface.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const encryption_util_1 = require("../../common/utils/encryption.util");
exports.EVENT_CLIENTE_SUSPENDIDO = 'mikrotik.cliente.suspendido';
exports.EVENT_CLIENTE_REACTIVADO = 'mikrotik.cliente.reactivado';
let MikrotikService = MikrotikService_1 = class MikrotikService {
    constructor(routerRepo, pool, pppoeSvc, queueSvc, firewallSvc, ifaceSvc, auditoria, events, ds) {
        this.routerRepo = routerRepo;
        this.pool = pool;
        this.pppoeSvc = pppoeSvc;
        this.queueSvc = queueSvc;
        this.firewallSvc = firewallSvc;
        this.ifaceSvc = ifaceSvc;
        this.auditoria = auditoria;
        this.events = events;
        this.ds = ds;
        this.logger = new common_1.Logger(MikrotikService_1.name);
    }
    async crearRouter(dto, user) {
        const existe = await this.routerRepo.findOne({
            where: { ipGestion: dto.ipGestion, empresaId: user.empresaId, deletedAt: null },
        });
        if (existe)
            throw new common_1.ConflictException(`Ya existe un router con IP ${dto.ipGestion}`);
        let passwordCifrado;
        try {
            passwordCifrado = (0, encryption_util_1.encrypt)(dto.password);
        }
        catch {
            passwordCifrado = dto.password;
        }
        const router = this.routerRepo.create({
            ...dto,
            passwordCifrado,
            empresaId: user.empresaId,
            estado: router_entity_1.EstadoEquipo.DESCONOCIDO,
        });
        const saved = await this.routerRepo.save(router);
        this.detectarVersionAsync(saved);
        await this.auditoria.logCreate({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            modulo: 'mikrotik', entidadId: saved.id,
            descripcion: `Router creado: ${dto.nombre} (${dto.ipGestion})`,
        });
        return saved;
    }
    async findAll(empresaId) {
        return this.routerRepo.find({
            where: { empresaId, activo: true, deletedAt: null },
            order: { nombre: 'ASC' },
        });
    }
    async findOne(id, empresaId) {
        const r = await this.routerRepo.findOne({ where: { id, empresaId, deletedAt: null } });
        if (!r)
            throw new common_1.NotFoundException(`Router ${id} no encontrado`);
        return r;
    }
    async updateRouter(id, dto, user) {
        const router = await this.findOne(id, user.empresaId);
        const updates = { ...dto };
        if (dto.password) {
            try {
                updates.passwordCifrado = (0, encryption_util_1.encrypt)(dto.password);
            }
            catch {
                updates.passwordCifrado = dto.password;
            }
            delete updates.password;
        }
        await this.routerRepo.update(id, updates);
        if (dto.ipGestion || dto.password) {
            await this.pool.invalidate(id);
        }
        return this.findOne(id, user.empresaId);
    }
    async removeRouter(id, user) {
        await this.findOne(id, user.empresaId);
        await this.routerRepo.update(id, { deletedAt: new Date(), activo: false });
        await this.pool.invalidate(id);
    }
    async getCredentials(routerId, empresaId) {
        const router = await this.findOne(routerId, empresaId);
        const port = router.usarSsl ? router.puertoApiSsl : router.puertoApi;
        return {
            id: router.id,
            ip: router.ipGestion,
            port,
            user: router.usuario,
            passwordCifrado: router.passwordCifrado,
            useSsl: router.usarSsl,
            timeoutSec: router.timeoutConexion || 10,
            version: router.versionRos === router_entity_1.VersionRouterOS.V7 ? 'v7' : 'v6',
        };
    }
    async provisionarCliente(routerId, dto, user) {
        const creds = await this.getCredentials(routerId, user.empresaId);
        this.logger.log(`Provisionando cliente en ${creds.ip}: PPPoE=${dto.usuarioPppoe} | IP=${dto.ipAsignada} | ` +
            `${dto.uploadMbps}/${dto.downloadMbps} Mbps`);
        const ppppoeId = await this.pppoeSvc.crear(creds, {
            name: dto.usuarioPppoe,
            password: dto.passwordPppoe,
            profile: dto.perfilPppoe || 'default',
            service: 'pppoe',
            remoteAddress: dto.ipAsignada,
            comment: `FibraNet:ClienteID:${dto.clienteId}`,
            disabled: false,
        });
        const hasQueue = dto.tipoQueue === 'simple_queue' || !dto.tipoQueue;
        let queueId = '';
        if (hasQueue) {
            queueId = await this.queueSvc.crearSimpleQueue(creds, {
                name: dto.usuarioPppoe,
                target: `${dto.ipAsignada}/32`,
                maxLimitDown: dto.downloadMbps,
                maxLimitUp: dto.uploadMbps,
                burstLimitDown: dto.burstDownMbps,
                burstLimitUp: dto.burstUpMbps,
                burstTimeDown: dto.burstTiempoSegundos,
                burstTimeUp: dto.burstTiempoSegundos,
                comment: `FibraNet:ClienteID:${dto.clienteId}`,
            });
        }
        else if (dto.tipoQueue === 'queue_tree' || dto.tipoQueue === 'pcq') {
            const tienePcq = await this.queueSvc.tienePcqConfigurado(creds);
            if (!tienePcq) {
                await this.queueSvc.configurarPcqCompleto(creds, {
                    namePrefix: 'fibranet',
                    downloadMbps: dto.downloadMbps * 10,
                    uploadMbps: dto.uploadMbps * 10,
                });
            }
        }
        if (user.empresaId) {
            await this.firewallSvc.configurarReglasControl(creds).catch((err) => this.logger.warn(`No se pudieron verificar reglas firewall: ${err.message}`));
        }
        await this.auditoria.log({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            accion: 'PROVISION', modulo: 'mikrotik', entidadId: dto.clienteId,
            descripcion: `PPPoE ${dto.usuarioPppoe} provisionado en ${creds.ip} | IP: ${dto.ipAsignada}`,
        });
        return { ppppoeId, queueId };
    }
    async suspenderCliente(routerId, dto, user) {
        const creds = await this.getCredentials(routerId, user.empresaId);
        await this.firewallSvc.suspenderCliente(creds, dto.ipAsignada, dto.clienteId, `Mora - ${new Date().toLocaleDateString('es-PE')}`);
        if (dto.usuarioPppoe) {
            await this.pppoeSvc.desconectarSesion(creds, dto.usuarioPppoe).catch((err) => this.logger.warn(`No se pudo desconectar sesión ${dto.usuarioPppoe}: ${err.message}`));
        }
        this.events.emit(exports.EVENT_CLIENTE_SUSPENDIDO, {
            clienteId: dto.clienteId,
            empresaId: user.empresaId,
            ip: dto.ipAsignada,
            routerId,
        });
        await this.auditoria.log({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            accion: 'SUSPEND', modulo: 'mikrotik', entidadId: dto.clienteId,
            descripcion: `IP ${dto.ipAsignada} suspendida en ${creds.ip} | Motivo: ${dto.motivo || 'mora'}`,
        });
        this.logger.log(`Cliente suspendido: ${dto.clienteId} | IP: ${dto.ipAsignada} | router: ${creds.ip}`);
    }
    async reactivarCliente(routerId, dto, user) {
        const creds = await this.getCredentials(routerId, user.empresaId);
        await this.firewallSvc.reactivarCliente(creds, dto.ipAsignada);
        this.events.emit(exports.EVENT_CLIENTE_REACTIVADO, {
            clienteId: dto.clienteId,
            empresaId: user.empresaId,
            ip: dto.ipAsignada,
            routerId,
        });
        await this.auditoria.log({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            accion: 'REACTIVATE', modulo: 'mikrotik', entidadId: dto.clienteId,
            descripcion: `IP ${dto.ipAsignada} reactivada en ${creds.ip}`,
        });
        this.logger.log(`Cliente reactivado: ${dto.clienteId} | IP: ${dto.ipAsignada}`);
    }
    async getEstadoRouter(routerId, empresaId) {
        const router = await this.findOne(routerId, empresaId);
        const creds = await this.getCredentials(routerId, empresaId);
        const [recursos, interfaces, sesiones] = await Promise.all([
            this.ifaceSvc.getRecursos(creds),
            this.ifaceSvc.listarInterfaces(creds),
            this.pppoeSvc.listarSesionesActivas(creds),
        ]);
        await this.routerRepo.update(routerId, {
            estado: router_entity_1.EstadoEquipo.ONLINE,
            ultimoPing: new Date(),
            cpuUsoPct: recursos.cpuLoad,
            memoriaUsoPct: recursos.freeMemory
                ? Math.round((1 - recursos.freeMemory / recursos.totalMemory) * 100)
                : null,
            uptimeSegundos: recursos.uptimeSeconds,
            versionFirmware: recursos.version,
            identityRouteros: await this.ifaceSvc.getIdentity(creds).catch(() => ''),
            versionRos: recursos.version?.startsWith('7')
                ? router_entity_1.VersionRouterOS.V7
                : router_entity_1.VersionRouterOS.V6,
        });
        return {
            router: await this.findOne(routerId, empresaId),
            recursos,
            interfaces,
            sesionesActivas: sesiones.length,
            version: recursos.version,
        };
    }
    async getSesionesPppoe(routerId, empresaId) {
        const creds = await this.getCredentials(routerId, empresaId);
        return this.pppoeSvc.listarSesionesActivas(creds);
    }
    async getMorosos(routerId, empresaId) {
        const creds = await this.getCredentials(routerId, empresaId);
        return this.firewallSvc.listarMorosos(creds);
    }
    async getQueues(routerId, empresaId) {
        const creds = await this.getCredentials(routerId, empresaId);
        return this.queueSvc.listarSimpleQueues(creds);
    }
    async getInterfaces(routerId, empresaId) {
        const creds = await this.getCredentials(routerId, empresaId);
        return this.ifaceSvc.listarInterfaces(creds);
    }
    async getDhcpLeases(routerId, empresaId) {
        const creds = await this.getCredentials(routerId, empresaId);
        return this.firewallSvc.listarDhcpLeases(creds);
    }
    async getTrafico(routerId, empresaId, iface) {
        const creds = await this.getCredentials(routerId, empresaId);
        const interfaces = await this.ifaceSvc.listarInterfaces(creds);
        const target = iface || interfaces[0]?.name || 'ether1';
        return this.ifaceSvc.monitorearInterface(creds, target, 5);
    }
    async pingDesdeRouter(routerId, empresaId, destino) {
        const creds = await this.getCredentials(routerId, empresaId);
        return this.ifaceSvc.ping(creds, destino);
    }
    async configurarFirewallControl(routerId, empresaId) {
        const creds = await this.getCredentials(routerId, empresaId);
        await this.firewallSvc.configurarReglasControl(creds);
    }
    async testConexion(routerId, empresaId) {
        const router = await this.findOne(routerId, empresaId);
        const creds = await this.getCredentials(routerId, empresaId);
        const inicio = Date.now();
        try {
            await this.pool.invalidate(routerId);
            const identity = await this.ifaceSvc.getIdentity(creds);
            const latencia = Date.now() - inicio;
            await this.routerRepo.update(routerId, {
                estado: router_entity_1.EstadoEquipo.ONLINE,
                ultimoPing: new Date(),
                latenciaMs: latencia,
                identityRouteros: identity,
            });
            return { exitoso: true, mensaje: `Conectado a "${identity}" en ${latencia}ms`, latenciaMs: latencia };
        }
        catch (error) {
            await this.routerRepo.update(routerId, { estado: router_entity_1.EstadoEquipo.OFFLINE });
            return { exitoso: false, mensaje: `No se pudo conectar: ${error.message}` };
        }
    }
    detectarVersionAsync(router) {
        const creds = {
            id: router.id,
            ip: router.ipGestion,
            port: router.usarSsl ? router.puertoApiSsl : router.puertoApi,
            user: router.usuario,
            passwordCifrado: router.passwordCifrado,
            useSsl: router.usarSsl,
            timeoutSec: 10,
            version: 'v6',
        };
        this.ifaceSvc.detectarVersion(creds)
            .then((version) => {
            const rosVersion = version === 'v7' ? router_entity_1.VersionRouterOS.V7 : router_entity_1.VersionRouterOS.V6;
            return this.routerRepo.update(router.id, { versionRos: rosVersion });
        })
            .catch((err) => this.logger.warn(`No se pudo detectar versión de ${router.ipGestion}: ${err.message}`));
    }
};
exports.MikrotikService = MikrotikService;
exports.MikrotikService = MikrotikService = MikrotikService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(router_entity_1.Router)),
    __param(8, (0, typeorm_3.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        connection_pool_service_1.RouterConnectionPool,
        pppoe_service_1.PppoeService,
        queue_service_1.QueueService,
        firewall_service_1.FirewallService,
        interface_service_1.InterfaceService,
        auditoria_service_1.AuditoriaService,
        event_emitter_1.EventEmitter2,
        typeorm_4.DataSource])
], MikrotikService);
//# sourceMappingURL=mikrotik.service.js.map