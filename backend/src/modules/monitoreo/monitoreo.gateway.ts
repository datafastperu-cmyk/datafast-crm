// Ruta: /opt/datafast/backend/src/modules/monitoreo/monitoreo.gateway.ts

import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger }         from '@nestjs/common';
import { JwtService }     from '@nestjs/jwt';
import { ConfigService }  from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { NivelAlerta, StatusDispositivo } from './enums/monitoreo.enums';

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
  ) {}

  handleConnection(client: Socket): void {
    try {
      const raw =
        (client.handshake?.auth?.token as string) ??
        (client.handshake?.headers?.authorization as string ?? '');
      const token = raw.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Token no proporcionado');

      const payload = this.jwtService.verify(token, {
        secret:   this.configService.get<string>('jwt.secret'),
        issuer:   'datafast-crm',
        audience: 'datafast-app',
      });

      (client as any).user = payload;
      // Unir al room de la empresa para broadcasts multi-tenant
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
  onSubscribe(
    @MessageBody() data: { nodoId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    if (data?.nodoId) client.join(`nodo:${data.nodoId}`);
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
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:medicion', payload);
  }

  emitirAlerta(payload: AlertaPayload): void {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:alerta', payload);
  }

  emitirRecuperacion(payload: AlertaPayload): void {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:recovery', payload);
  }

  emitirNodoStatus(payload: NodoStatusPayload): void {
    this.server
      .to(`empresa:${payload.empresaId}`)
      .emit('monitoreo:nodo_status', payload);
    // También al room del nodo específico para subscriptores individuales
    this.server
      .to(`nodo:${payload.nodoId}`)
      .emit('monitoreo:nodo_status', payload);
  }
}
