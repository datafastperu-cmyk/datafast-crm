import {
  WebSocketGateway, WebSocketServer,
  SubscribeMessage, OnGatewayConnection,
  OnGatewayDisconnect, OnGatewayInit,
  MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket }   from 'socket.io';
import { Logger }           from '@nestjs/common';
import { JwtService }       from '@nestjs/jwt';
import { ConfigService }    from '@nestjs/config';
import { OnEvent }          from '@nestjs/event-emitter';
import {
  EVENTO_ALERTA_NUEVA, EVENTO_ALERTA_RESUELTA,
  EVENTO_NODO_OFFLINE, EVENTO_NODO_ONLINE,
} from '../services/alertas.service';

// ─── Estructura de cliente conectado ────────────────────────
interface ClienteConectado {
  socketId:  string;
  empresaId: string;
  usuarioId: string;
  email:     string;
  roles:     string[];
  conectadoEn: Date;
}

// ─────────────────────────────────────────────────────────────
// MonitoreoGateway — WebSocket en tiempo real
//
// Rooms por empresa: 'empresa:{empresaId}'
// Rooms por nodo:    'nodo:{nodoId}'
//
// Eventos que emite al cliente:
//   monitoreo:medicion    — Medición de ping/SNMP de un nodo
//   monitoreo:alerta      — Nueva alerta generada
//   monitoreo:recovery    — Alerta resuelta
//   monitoreo:nodo_status — Cambio de estado online/offline
//   monitoreo:dashboard   — Resumen completo del dashboard
//
// Eventos que escucha del cliente:
//   monitoreo:subscribe   — Suscribirse a un nodo específico
//   monitoreo:unsubscribe — Desuscribirse de un nodo
//   monitoreo:ping        — Solicitar ping inmediato a una IP
// ─────────────────────────────────────────────────────────────
@WebSocketGateway({
  namespace:   '/monitoreo',
  cors: {
    origin:      ['http://localhost:3000', process.env.FRONTEND_URL || 'http://localhost:3000'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class MonitoreoGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MonitoreoGateway.name);
  private readonly clientes = new Map<string, ClienteConectado>();

  constructor(
    private readonly jwt:    JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Inicialización ────────────────────────────────────────
  afterInit(server: Server) {
    this.logger.log('MonitoreoGateway WebSocket iniciado en /monitoreo');

    // Middleware de autenticación JWT para cada conexión
    server.use((socket: Socket, next: Function) => {
      const token = socket.handshake?.auth?.token
        || socket.handshake?.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Token no proporcionado'));
      }

      try {
        const payload = this.jwt.verify(token, {
          secret:   this.config.get<string>('jwt.secret'),
          issuer:   'fibranet-isp',
          audience: 'fibranet-app',
        });
        (socket as any).user = payload;
        next();
      } catch (err) {
        next(new Error('Token inválido o expirado'));
      }
    });
  }

  // ── Conexión de nuevo cliente ────────────────────────────
  async handleConnection(socket: Socket) {
    const user = (socket as any).user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    // Registrar cliente conectado
    this.clientes.set(socket.id, {
      socketId:    socket.id,
      empresaId:   user.empresaId,
      usuarioId:   user.sub,
      email:       user.email,
      roles:       user.roles || [],
      conectadoEn: new Date(),
    });

    // Unir al room de su empresa automáticamente
    socket.join(`empresa:${user.empresaId}`);

    this.logger.log(
      `WS conectado: ${user.email} | empresa: ${user.empresaId} | ` +
      `total clientes: ${this.clientes.size}`,
    );

    // Enviar confirmación de conexión
    socket.emit('monitoreo:connected', {
      message:   'Conectado al sistema de monitoreo en tiempo real',
      empresaId: user.empresaId,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Desconexión de cliente ────────────────────────────────
  handleDisconnect(socket: Socket) {
    const cliente = this.clientes.get(socket.id);
    if (cliente) {
      this.logger.log(`WS desconectado: ${cliente.email} | total: ${this.clientes.size - 1}`);
      this.clientes.delete(socket.id);
    }
  }

  // ────────────────────────────────────────────────────────────
  // EVENTOS DEL CLIENTE → SERVIDOR
  // ────────────────────────────────────────────────────────────

  // Suscribirse a actualizaciones de un nodo específico
  @SubscribeMessage('monitoreo:subscribe')
  handleSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { nodoId: string },
  ) {
    if (!data?.nodoId) return;
    const room = `nodo:${data.nodoId}`;
    socket.join(room);
    socket.emit('monitoreo:subscribed', { nodoId: data.nodoId, room });
    this.logger.debug(`Socket ${socket.id} suscrito a nodo ${data.nodoId}`);
  }

  @SubscribeMessage('monitoreo:unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { nodoId: string },
  ) {
    if (!data?.nodoId) return;
    socket.leave(`nodo:${data.nodoId}`);
    socket.emit('monitoreo:unsubscribed', { nodoId: data.nodoId });
  }

  // ────────────────────────────────────────────────────────────
  // BROADCASTS: SERVIDOR → CLIENTES (vía EventEmitter)
  // ────────────────────────────────────────────────────────────

  // Emitir medición de un nodo a todos los clientes de la empresa
  broadcastMedicion(empresaId: string, datos: {
    nodoId:      string;
    nodoNombre:  string;
    estado:      string;
    latenciaMs:  number | null;
    perdidaPct:  number;
    cpuPct?:     number;
    memoriaPct?: number;
    traficoRxBps?: number;
    traficoTxBps?: number;
    temperatura?:  number;
    sesionesPppoe?: number;
    timestamp:   string;
  }) {
    // Broadcast a la empresa
    this.server.to(`empresa:${empresaId}`).emit('monitoreo:medicion', datos);

    // Broadcast al room específico del nodo
    this.server.to(`nodo:${datos.nodoId}`).emit('monitoreo:medicion', datos);
  }

  // Dashboard completo (para carga inicial del frontend)
  broadcastDashboard(empresaId: string, dashboard: any) {
    this.server.to(`empresa:${empresaId}`).emit('monitoreo:dashboard', dashboard);
  }

  // ── Listeners de eventos internos (EventEmitter) ─────────

  @OnEvent(EVENTO_ALERTA_NUEVA)
  onAlertaNueva(payload: { alerta: any; empresaId: string }) {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:alerta', {
        tipo:      'nueva',
        alerta:    payload.alerta,
        timestamp: new Date().toISOString(),
      });

    this.logger.debug(`WS broadcast alerta nueva: ${payload.alerta.nodoNombre}`);
  }

  @OnEvent(EVENTO_ALERTA_RESUELTA)
  onAlertaResuelta(payload: any) {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:recovery', {
        tipo:        'resuelta',
        alertaId:    payload.alertaId,
        nodoId:      payload.nodoId,
        nodoNombre:  payload.nodoNombre,
        metrica:     payload.metrica,
        duracionMin: payload.duracionMin,
        timestamp:   payload.timestamp,
      });
  }

  @OnEvent(EVENTO_NODO_OFFLINE)
  onNodoOffline(payload: any) {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:nodo_status', {
        nodoId:     payload.nodoId,
        nodoNombre: payload.nodoNombre,
        estado:     'offline',
        alertaId:   payload.alertaId,
        timestamp:  payload.timestamp,
      });
  }

  @OnEvent(EVENTO_NODO_ONLINE)
  onNodoOnline(payload: any) {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:nodo_status', {
        nodoId:     payload.nodoId,
        nodoNombre: payload.nodoNombre,
        estado:     'online',
        timestamp:  payload.timestamp,
      });
  }

  @OnEvent('aprovisionamiento.completado')
  onAprovisionamientoCompletado(payload: any) {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('aprovisionamiento:completado', payload);
  }

  @OnEvent('mikrotik.cliente.suspendido')
  onClienteSuspendido(payload: any) {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('mikrotik:estado', { tipo: 'suspendido', ...payload });
  }

  @OnEvent('mikrotik.cliente.reactivado')
  onClienteReactivado(payload: any) {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('mikrotik:estado', { tipo: 'reactivado', ...payload });
  }

  // ────────────────────────────────────────────────────────────
  // STATS DEL GATEWAY (para el endpoint de diagnóstico)
  // ────────────────────────────────────────────────────────────
  getStats(): {
    clientesConectados: number;
    porEmpresa:         Record<string, number>;
    uptime:             number;
  } {
    const porEmpresa: Record<string, number> = {};
    for (const c of this.clientes.values()) {
      porEmpresa[c.empresaId] = (porEmpresa[c.empresaId] || 0) + 1;
    }
    return {
      clientesConectados: this.clientes.size,
      porEmpresa,
      uptime: process.uptime(),
    };
  }
}
