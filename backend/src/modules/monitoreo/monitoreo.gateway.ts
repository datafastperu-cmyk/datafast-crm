// Ruta: /opt/datafast/backend/src/modules/monitoreo/monitoreo.gateway.ts

import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { JwtService }         from '@nestjs/jwt';
import { ConfigService }      from '@nestjs/config';
import { Server, Socket }     from 'socket.io';
import { NivelAlerta, StatusDispositivo } from './enums/monitoreo.enums';
import { DispositivoMonitoreo }           from './entities/dispositivo-monitoreo.entity';
import { JwtPayload }                     from '../../common/decorators/current-user.decorator';

// Socket con usuario autenticado tipado
type AuthSocket = Socket & { user: JwtPayload };

export interface MedicionPayload {
  nodoId:         string;
  empresaId:      string;
  pingLatenciaMs: number | null;
  pingLossPct:    number | null;
  cpuUsagePct:    number | null;
  memoryUsagePct: number | null;
  trafficDownBps: string | null;
  trafficUpBps:   string | null;
  timestamp:      string;
}

export interface AlertaPayload {
  nodoId:    string;
  empresaId: string;
  alertaId:  string;
  nivel:     NivelAlerta;
  categoria: string;
  mensaje:   string;
  timestamp: string;
}

export interface NodoStatusPayload {
  nodoId:    string;
  empresaId: string;
  status:    StatusDispositivo;
  nombre:    string;
  timestamp: string;
}

@Injectable()
@WebSocketGateway({
  namespace: '/monitoreo',
  cors: {
    origin:      ['https://erp.datafastperu.com', 'http://localhost:3000', 'http://localhost:4000'],
    credentials: true,
  },
})
export class MonitoreoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(MonitoreoGateway.name);

  constructor(
    private readonly jwtService:    JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(DispositivoMonitoreo)
    private readonly dispoRepo: Repository<DispositivoMonitoreo>,
  ) {}

  handleConnection(client: Socket): void {
    try {
      const raw =
        (client.handshake?.auth?.token as string) ??
        (client.handshake?.headers?.authorization as string ?? '');
      const token = raw.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Token no proporcionado');

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret:   this.configService.get<string>('jwt.secret'),
        issuer:   'datafast-crm',
        audience: 'datafast-app',
      });

      (client as AuthSocket).user = payload;
      client.join(`empresa:${payload.empresaId}`);
      this.logger.debug(`WS /monitoreo conectado: ${client.id} | empresa: ${payload.empresaId}`);
    } catch (err: any) {
      this.logger.warn(`WS /monitoreo auth fallida: ${err.message} | socket: ${client.id}`);
      client.emit('error', { message: 'No autorizado', code: 'WS_UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS /monitoreo desconectado: ${client.id}`);
  }

  // ── Suscripción a un nodo específico (room adicional) ────────
  @SubscribeMessage('monitoreo:subscribe')
  async onSubscribe(
    @MessageBody() data: { nodoId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!data?.nodoId) return;
    const user = (client as AuthSocket).user;
    if (!user) return;
    const nodo = await this.dispoRepo.findOne({
      where: { id: data.nodoId, empresaId: user.empresaId, deletedAt: IsNull() },
    });
    if (nodo) client.join(`nodo:${data.nodoId}`);
  }

  @SubscribeMessage('monitoreo:unsubscribe')
  onUnsubscribe(
    @MessageBody() data: { nodoId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    if (data?.nodoId) client.leave(`nodo:${data.nodoId}`);
  }

  // ── Métodos de emisión (llamados por MonitoreoWorkerService) ─

  emitirMedicion(payload: MedicionPayload): void {
    this.server
      ?.to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:medicion', payload);
  }

  emitirAlerta(payload: AlertaPayload): void {
    this.server
      ?.to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:alerta', payload);
  }

  emitirNodoStatus(payload: NodoStatusPayload): void {
    this.server
      ?.to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:nodo_status', payload);
    // Room del nodo para subscriptores de drill-down individual
    this.server
      ?.to(`nodo:${payload.nodoId}`)
      .emit('monitoreo:nodo_status', payload);
  }
}
