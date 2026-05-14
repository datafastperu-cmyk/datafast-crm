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
var MonitoreoGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoreoGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const event_emitter_1 = require("@nestjs/event-emitter");
const alertas_service_1 = require("../services/alertas.service");
let MonitoreoGateway = MonitoreoGateway_1 = class MonitoreoGateway {
    constructor(jwt, config) {
        this.jwt = jwt;
        this.config = config;
        this.logger = new common_1.Logger(MonitoreoGateway_1.name);
        this.clientes = new Map();
    }
    afterInit(server) {
        this.logger.log('MonitoreoGateway WebSocket iniciado en /monitoreo');
        server.use((socket, next) => {
            const token = socket.handshake?.auth?.token
                || socket.handshake?.headers?.authorization?.replace('Bearer ', '');
            if (!token) {
                return next(new Error('Token no proporcionado'));
            }
            try {
                const payload = this.jwt.verify(token, {
                    secret: this.config.get('jwt.secret'),
                    issuer: 'fibranet-isp',
                    audience: 'fibranet-app',
                });
                socket.user = payload;
                next();
            }
            catch (err) {
                next(new Error('Token inválido o expirado'));
            }
        });
    }
    async handleConnection(socket) {
        const user = socket.user;
        if (!user) {
            socket.disconnect(true);
            return;
        }
        this.clientes.set(socket.id, {
            socketId: socket.id,
            empresaId: user.empresaId,
            usuarioId: user.sub,
            email: user.email,
            roles: user.roles || [],
            conectadoEn: new Date(),
        });
        socket.join(`empresa:${user.empresaId}`);
        this.logger.log(`WS conectado: ${user.email} | empresa: ${user.empresaId} | ` +
            `total clientes: ${this.clientes.size}`);
        socket.emit('monitoreo:connected', {
            message: 'Conectado al sistema de monitoreo en tiempo real',
            empresaId: user.empresaId,
            timestamp: new Date().toISOString(),
        });
    }
    handleDisconnect(socket) {
        const cliente = this.clientes.get(socket.id);
        if (cliente) {
            this.logger.log(`WS desconectado: ${cliente.email} | total: ${this.clientes.size - 1}`);
            this.clientes.delete(socket.id);
        }
    }
    handleSubscribe(socket, data) {
        if (!data?.nodoId)
            return;
        const room = `nodo:${data.nodoId}`;
        socket.join(room);
        socket.emit('monitoreo:subscribed', { nodoId: data.nodoId, room });
        this.logger.debug(`Socket ${socket.id} suscrito a nodo ${data.nodoId}`);
    }
    handleUnsubscribe(socket, data) {
        if (!data?.nodoId)
            return;
        socket.leave(`nodo:${data.nodoId}`);
        socket.emit('monitoreo:unsubscribed', { nodoId: data.nodoId });
    }
    broadcastMedicion(empresaId, datos) {
        this.server.to(`empresa:${empresaId}`).emit('monitoreo:medicion', datos);
        this.server.to(`nodo:${datos.nodoId}`).emit('monitoreo:medicion', datos);
    }
    broadcastDashboard(empresaId, dashboard) {
        this.server.to(`empresa:${empresaId}`).emit('monitoreo:dashboard', dashboard);
    }
    onAlertaNueva(payload) {
        this.server
            .to(`empresa:${payload.empresaId}`)
            .emit('monitoreo:alerta', {
            tipo: 'nueva',
            alerta: payload.alerta,
            timestamp: new Date().toISOString(),
        });
        this.logger.debug(`WS broadcast alerta nueva: ${payload.alerta.nodoNombre}`);
    }
    onAlertaResuelta(payload) {
        this.server
            .to(`empresa:${payload.empresaId}`)
            .emit('monitoreo:recovery', {
            tipo: 'resuelta',
            alertaId: payload.alertaId,
            nodoId: payload.nodoId,
            nodoNombre: payload.nodoNombre,
            metrica: payload.metrica,
            duracionMin: payload.duracionMin,
            timestamp: payload.timestamp,
        });
    }
    onNodoOffline(payload) {
        this.server
            .to(`empresa:${payload.empresaId}`)
            .emit('monitoreo:nodo_status', {
            nodoId: payload.nodoId,
            nodoNombre: payload.nodoNombre,
            estado: 'offline',
            alertaId: payload.alertaId,
            timestamp: payload.timestamp,
        });
    }
    onNodoOnline(payload) {
        this.server
            .to(`empresa:${payload.empresaId}`)
            .emit('monitoreo:nodo_status', {
            nodoId: payload.nodoId,
            nodoNombre: payload.nodoNombre,
            estado: 'online',
            timestamp: payload.timestamp,
        });
    }
    onAprovisionamientoCompletado(payload) {
        this.server
            .to(`empresa:${payload.empresaId}`)
            .emit('aprovisionamiento:completado', payload);
    }
    onClienteSuspendido(payload) {
        this.server
            .to(`empresa:${payload.empresaId}`)
            .emit('mikrotik:estado', { tipo: 'suspendido', ...payload });
    }
    onClienteReactivado(payload) {
        this.server
            .to(`empresa:${payload.empresaId}`)
            .emit('mikrotik:estado', { tipo: 'reactivado', ...payload });
    }
    getStats() {
        const porEmpresa = {};
        for (const c of this.clientes.values()) {
            porEmpresa[c.empresaId] = (porEmpresa[c.empresaId] || 0) + 1;
        }
        return {
            clientesConectados: this.clientes.size,
            porEmpresa,
            uptime: process.uptime(),
        };
    }
};
exports.MonitoreoGateway = MonitoreoGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], MonitoreoGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('monitoreo:subscribe'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "handleSubscribe", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('monitoreo:unsubscribe'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "handleUnsubscribe", null);
__decorate([
    (0, event_emitter_1.OnEvent)(alertas_service_1.EVENTO_ALERTA_NUEVA),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "onAlertaNueva", null);
__decorate([
    (0, event_emitter_1.OnEvent)(alertas_service_1.EVENTO_ALERTA_RESUELTA),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "onAlertaResuelta", null);
__decorate([
    (0, event_emitter_1.OnEvent)(alertas_service_1.EVENTO_NODO_OFFLINE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "onNodoOffline", null);
__decorate([
    (0, event_emitter_1.OnEvent)(alertas_service_1.EVENTO_NODO_ONLINE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "onNodoOnline", null);
__decorate([
    (0, event_emitter_1.OnEvent)('aprovisionamiento.completado'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "onAprovisionamientoCompletado", null);
__decorate([
    (0, event_emitter_1.OnEvent)('mikrotik.cliente.suspendido'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "onClienteSuspendido", null);
__decorate([
    (0, event_emitter_1.OnEvent)('mikrotik.cliente.reactivado'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MonitoreoGateway.prototype, "onClienteReactivado", null);
exports.MonitoreoGateway = MonitoreoGateway = MonitoreoGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        namespace: '/monitoreo',
        cors: {
            origin: ['http://localhost:3000', process.env.FRONTEND_URL || 'http://localhost:3000'],
            credentials: true,
        },
        transports: ['websocket', 'polling'],
    }),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        config_1.ConfigService])
], MonitoreoGateway);
//# sourceMappingURL=monitoreo.gateway.js.map