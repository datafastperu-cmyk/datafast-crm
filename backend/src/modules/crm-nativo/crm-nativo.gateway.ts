import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WaStateService, WaStatusPayload } from './wa-state.service';
import { CrmNativoService } from './crm-nativo.service';
import { CrmChat }    from './entities/crm-chat.entity';
import { CrmMensaje } from './entities/crm-mensaje.entity';

export interface WaMensajeEvento {
  chatId:  string;
  mensaje: Partial<CrmMensaje>;
}

@WebSocketGateway({
  namespace: '/crm-nativo',
  cors: { origin: '*', credentials: false },
})
export class CrmNativoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CrmNativoGateway.name);

  constructor(
    private readonly state:   WaStateService,
    private readonly crmSvc:  CrmNativoService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.debug(`WS conectado: ${client.id}`);
    // Enviar estado actual al nuevo cliente
    client.emit('wa:status', this.state.snapshot());
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`WS desconectado: ${client.id}`);
  }

  // ── Emitir estado del cliente WA (QR / CONECTADO / etc.) ─────
  emitStatus(payload: WaStatusPayload) {
    this.state.setEstado(payload.estado, payload.qr);
    this.server.emit('wa:status', payload);
  }

  // ── Emitir lista completa de chats ────────────────────────────
  emitChats(chats: CrmChat[]) {
    this.server.emit('wa:chats', chats);
  }

  // ── Emitir nuevo mensaje de un chat ──────────────────────────
  emitMensaje(evento: WaMensajeEvento) {
    this.server.emit('wa:mensaje', evento);
  }

  // ── Emitir actualización de un chat (último mensaje, no_leidos) ─
  emitChatUpdate(chat: CrmChat) {
    this.server.emit('wa:chat_update', chat);
  }

  // ── El frontend pide marcar chat como leído ───────────────────
  @SubscribeMessage('crm:leer_chat')
  async onLeerChat(
    @MessageBody() data: { chatId: string },
    @ConnectedSocket() _client: Socket,
  ) {
    await this.crmSvc.resetNoLeidos(data.chatId);
  }
}
