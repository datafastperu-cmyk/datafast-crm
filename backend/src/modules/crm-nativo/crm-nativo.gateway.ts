import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger }     from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { WaStateService, WaStatusPayload } from './wa-state.service';
import { CrmNativoService } from './crm-nativo.service';
import { CrmChat }    from './entities/crm-chat.entity';
import { CrmMensaje } from './entities/crm-mensaje.entity';

export interface WaMensajeEvento {
  chatId:  string;
  mensaje: Partial<CrmMensaje>;
}

// `path` propio: el cliente de WhatsApp vive en su propio proceso PM2
// (datafast-whatsapp), separado de api-core y del worker porque es un módulo
// complementario y Chromium no puede poner en riesgo al core. nginx enruta este
// path — y sólo este — a ese proceso; el namespace viaja en el payload de
// socket.io, así que no sirve para enrutar.
//
// Orígenes por env (regla de Portabilidad Multi-VPS): antes el dominio de una
// instalación concreta estaba escrito en el código.
const CRM_WS_ORIGINS = (process.env.CRM_WS_ORIGINS ?? process.env.APP_URL ?? '')
  .split(',').map(o => o.trim()).filter(Boolean);

// El path va bajo /api/ a propósito: el middleware de Next intercepta todo lo
// demás (redirige a /login) y además normaliza la barra final con un 308, así que
// un path propio fuera de /api/ no sobrevive al proxy por el que entra el operador.
@WebSocketGateway({
  path:      '/api/wa-socket/',
  namespace: '/crm-nativo',
  cors: {
    origin: [...CRM_WS_ORIGINS, 'http://localhost:3000', 'http://localhost:4000'],
    credentials: true,
  },
})
export class CrmNativoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CrmNativoGateway.name);

  constructor(
    private readonly state:   WaStateService,
    private readonly crmSvc:  CrmNativoService,
    private readonly jwt:     JwtService,
  ) {}

  // El namespace emitía la lista completa de conversaciones a cualquier socket que
  // conectara, sin credencial alguna, y aceptaba `crm:leer_chat` sobre cualquier
  // chatId. El token viaja en el handshake (auth.token o Authorization).
  private empresaDe(client: Socket): string | null {
    try {
      const raw =
        (client.handshake.auth as Record<string, string> | undefined)?.token ??
        (client.handshake.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!raw) return null;
      const payload = this.jwt.verify<{ empresaId?: string }>(raw);
      return payload?.empresaId ?? null;
    } catch {
      return null;
    }
  }

  handleConnection(client: Socket) {
    const empresaId = this.empresaDe(client);
    if (!empresaId) {
      this.logger.warn(`WS rechazado (sin token válido): ${client.id}`);
      client.emit('wa:error', { mensaje: 'Sesión no válida' });
      client.disconnect(true);
      return;
    }
    client.data.empresaId = empresaId;
    this.logger.debug(`WS conectado: ${client.id} (empresa=${empresaId})`);
    const snap = this.state.snapshot();

    const enviarChats = () =>
      this.crmSvc.listarChats(empresaId)
        .then(chats => { if (chats.length) client.emit('wa:chats', chats); })
        .catch(() => {});

    // El estado que se emite es el que reporta el cliente WA, nunca uno inferido.
    // Antes, un `INICIANDO` con directorio de sesión en disco se traducía a
    // CONECTADO: entre el 22/07 y el 30/07 de 2026 el operador vio "conectado"
    // mientras WhatsApp llevaba 8 días pidiendo QR. Un directorio en disco prueba
    // que hubo una sesión alguna vez, no que la haya ahora.
    client.emit('wa:status', snap);

    // Si ya está conectado, enviar chats al nuevo cliente inmediatamente
    if (snap.estado === 'CONECTADO') {
      enviarChats();
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
    @ConnectedSocket() client: Socket,
  ) {
    const empresaId = client.data?.empresaId as string | undefined;
    if (!empresaId || !data?.chatId) return;
    await this.crmSvc.resetNoLeidos(data.chatId, empresaId);
  }
}
