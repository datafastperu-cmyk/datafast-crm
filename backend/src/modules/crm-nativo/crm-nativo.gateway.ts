import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as fs   from 'fs';
import * as path from 'path';
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
  cors: {
    origin: ['https://erp.datafastperu.com', 'http://localhost:3000', 'http://localhost:4000'],
    credentials: true,
  },
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
    const snap = this.state.snapshot();

    // Fallback: si memoria dice INICIANDO pero sesión existe en disco → CONECTADO
    if (snap.estado === 'INICIANDO') {
      const sessionPath = process.env.WA_SESSION_PATH || '/opt/datafast/.wwebjs_auth';
      const sessionDir  = path.join(sessionPath, 'session-datafast-crm');
      if (fs.existsSync(sessionDir)) {
        client.emit('wa:status', { estado: 'CONECTADO' });
        // Enviar lista de chats actuales para no dejar la pantalla vacía
        this.crmSvc.listarChatsActivos()
          .then(chats => { if (chats.length) client.emit('wa:chats', chats); })
          .catch(() => {});
        return;
      }
    }

    client.emit('wa:status', snap);

    // Si ya está conectado, enviar chats al nuevo cliente inmediatamente
    if (snap.estado === 'CONECTADO') {
      this.crmSvc.listarChatsActivos()
        .then(chats => { if (chats.length) client.emit('wa:chats', chats); })
        .catch(() => {});
    }
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
