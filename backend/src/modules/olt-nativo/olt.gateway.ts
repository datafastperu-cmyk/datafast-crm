import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService }         from '@nestjs/jwt';
import { ConfigService }      from '@nestjs/config';
import { OnEvent }            from '@nestjs/event-emitter';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';
import { Server, Socket }     from 'socket.io';
import { JwtPayload }         from '../../common/decorators/current-user.decorator';
import {
  OLT_SYNC_PROGRESS,
  OLT_SYNC_COMPLETED,
  OLT_SYNC_ERROR,
  OltSyncProgressPayload,
  OltSyncResultPayload,
  OltSyncErrorPayload,
} from './services/olt-sync.service';
import { RED_ONU_SEÑAL, RED_BATCH_DONE } from '../red/red-onus.service';

// ─────────────────────────────────────────────────────────────
// OltGateway — WebSocket namespace /olt
//
// Salas:
//   empresa:{empresaId}   — todos los sockets de la empresa
//   olt:{oltId}           — subscriptores de una OLT concreta
//
// Eventos de entrada (cliente → servidor):
//   olt:subscribe   { oltId }  — unirse a sala olt:{oltId}
//   olt:unsubscribe { oltId }  — salir de la sala
//
// Eventos de salida (servidor → cliente):
//   olt:sync:progress   OltSyncProgressPayload
//   olt:sync:completed  OltSyncResultPayload
//   olt:sync:error      OltSyncErrorPayload
// ─────────────────────────────────────────────────────────────

type AuthSocket = Socket & { user: JwtPayload };

@Injectable()
@WebSocketGateway({
  namespace: '/olt',
  cors: {
    origin:      ['https://erp.datafastperu.com', 'http://localhost:3000', 'http://localhost:4000'],
    credentials: true,
  },
})
export class OltGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(OltGateway.name);

  constructor(
    private readonly jwtService:    JwtService,
    private readonly configService: ConfigService,
    @InjectDataSource()
    private readonly ds:            DataSource,
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
      this.logger.debug(`WS /olt conectado: ${client.id} | empresa: ${payload.empresaId}`);
    } catch (err: any) {
      this.logger.warn(`WS /olt auth fallida: ${err.message} | socket: ${client.id}`);
      client.emit('error', { message: 'No autorizado', code: 'WS_UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS /olt desconectado: ${client.id}`);
  }

  @SubscribeMessage('olt:subscribe')
  async onSubscribe(
    @MessageBody() data: { oltId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!data?.oltId) return;
    const user = (client as AuthSocket).user;
    const rows = await this.ds.query<{ empresa_id: string }[]>(
      `SELECT empresa_id FROM olt_dispositivos WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [data.oltId],
    );
    if (!rows.length || rows[0].empresa_id !== user?.empresaId) {
      client.emit('error', { message: 'No autorizado para esta OLT', code: 'WS_OLT_FORBIDDEN' });
      return;
    }
    client.join(`olt:${data.oltId}`);
  }

  @SubscribeMessage('olt:unsubscribe')
  onUnsubscribe(
    @MessageBody() data: { oltId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    if (data?.oltId) client.leave(`olt:${data.oltId}`);
  }

  // ── Retransmisión de eventos EventEmitter2 → WebSocket ───────

  @OnEvent(OLT_SYNC_PROGRESS)
  onSyncProgress(payload: OltSyncProgressPayload): void {
    this.server
      ?.to(`olt:${payload.oltId}`)
      .emit('olt:sync:progress', payload);
  }

  @OnEvent(OLT_SYNC_COMPLETED)
  onSyncCompleted(payload: OltSyncResultPayload): void {
    this.server
      ?.to(`olt:${payload.oltId}`)
      .emit('olt:sync:completed', payload);
  }

  @OnEvent(OLT_SYNC_ERROR)
  onSyncError(payload: OltSyncErrorPayload): void {
    this.server
      ?.to(`olt:${payload.oltId}`)
      .emit('olt:sync:error', payload);
  }

  // ── Eventos señal batch (RedModule) ──────────────────────────

  @OnEvent(RED_ONU_SEÑAL)
  onOnuSenal(payload: Record<string, unknown>): void {
    const empresaId = payload.empresaId as string;
    if (empresaId) this.server?.to(`empresa:${empresaId}`).emit('onu:señal', payload);
  }

  @OnEvent(RED_BATCH_DONE)
  onBatchDone(payload: Record<string, unknown>): void {
    const empresaId = payload.empresaId as string;
    if (empresaId) this.server?.to(`empresa:${empresaId}`).emit('bulk:señal:completado', payload);
  }
}
