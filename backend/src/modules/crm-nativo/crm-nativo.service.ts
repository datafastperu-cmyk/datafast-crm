import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository, In, MoreThan, LessThan } from 'typeorm';
import { CrmChat }    from './entities/crm-chat.entity';
import { CrmMensaje } from './entities/crm-mensaje.entity';

export interface ChatDto {
  waChatId:       string;
  telefono:       string;
  nombreContacto: string | null;
  ultimoMensaje:  string | null;
  ultimoMsgAt:    Date   | null;
  noLeidos:       number;
}

export interface MensajeDto {
  waMsgId:   string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  agente:    string | null;
  body:      string;
  mediaUrl?: string | null;
  createdAt?: Date;
}

@Injectable()
export class CrmNativoService {
  private readonly logger = new Logger(CrmNativoService.name);

  constructor(
    @InjectRepository(CrmChat)    private readonly chatRepo:    Repository<CrmChat>,
    @InjectRepository(CrmMensaje) private readonly mensajeRepo: Repository<CrmMensaje>,
  ) {}

  // ── Upsert chat ──────────────────────────────────────────────
  async upsertChat(empresaId: string, dto: ChatDto): Promise<CrmChat> {
    if (dto.waChatId?.endsWith('@g.us')) return null!;

    let chat = await this.chatRepo.findOne({
      where: { empresaId, waChatId: dto.waChatId },
    });

    if (!chat) {
      chat = this.chatRepo.create({
        empresaId,
        waChatId:       dto.waChatId,
        telefono:       dto.telefono,
        nombreContacto: dto.nombreContacto,
        noLeidos:       0,
      });
    }

    chat.ultimoMensaje  = dto.ultimoMensaje  ?? chat.ultimoMensaje;
    chat.ultimoMsgAt    = dto.ultimoMsgAt    ?? chat.ultimoMsgAt;
    chat.nombreContacto = dto.nombreContacto ?? chat.nombreContacto;
    // Actualizar teléfono solo si el nuevo valor parece un número real (≤13 dígitos).
    // Valores de 15+ dígitos son LIDs de Meta y no deben sobrescribir un número legítimo.
    if (dto.telefono && dto.telefono.length <= 13) chat.telefono = dto.telefono;
    const addLeidos = Number.isFinite(dto.noLeidos) && dto.noLeidos > 0 ? dto.noLeidos : 0;
    if (addLeidos > 0) chat.noLeidos = (Number.isFinite(chat.noLeidos) ? chat.noLeidos : 0) + addLeidos;

    return this.chatRepo.save(chat);
  }

  // ── Guardar mensaje ──────────────────────────────────────────
  async guardarMensaje(
    empresaId: string,
    chatId:    string,
    dto:       MensajeDto,
  ): Promise<CrmMensaje> {
    const msg = this.mensajeRepo.create({
      chatId,
      empresaId,
      waMsgId:   dto.waMsgId,
      direction: dto.direction,
      agente:    dto.agente,
      body:      dto.body,
      mediaUrl:  dto.mediaUrl ?? null,
    });
    return this.mensajeRepo.save(msg);
  }

  // ── Resetear no_leidos al abrir chat ─────────────────────────
  async resetNoLeidos(chatId: string): Promise<void> {
    await this.chatRepo.update(chatId, { noLeidos: 0 });
  }

  // ── Listar chats ─────────────────────────────────────────────
  async listarChats(empresaId: string): Promise<CrmChat[]> {
    return this.chatRepo.find({
      where:  { empresaId },
      order:  { ultimoMsgAt: 'DESC' },
      take:   500,
    });
  }

  // Resuelve el empresaId de la empresa activa.
  // Prioridad: env var WA_EMPRESA_ID → primera empresa en BD (single-tenant).
  // Se cachea en memoria; usar env var para override explícito en producción.
  private cachedEmpresaId: string | null = null;
  async resolverEmpresaId(): Promise<string | null> {
    if (process.env.WA_EMPRESA_ID) return process.env.WA_EMPRESA_ID;
    if (!this.cachedEmpresaId) {
      const rows = await this.chatRepo.manager
        .query('SELECT id FROM empresas ORDER BY created_at ASC LIMIT 1')
        .catch(() => []);
      this.cachedEmpresaId = rows[0]?.id ?? null;
    }
    return this.cachedEmpresaId;
  }

  // ── Listar mensajes de un chat ────────────────────────────────
  // Acepta UUID de chat o número telefónico limpio.
  // Fusiona mensajes de todos los chats con el mismo telefono para resolver
  // el caso donde el mismo contacto tiene chats @lid y @c.us separados.
  async listarMensajes(chatIdOrPhone: string, limit = 50): Promise<CrmMensaje[]> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatIdOrPhone);

    let chatIds: string[];
    if (isUuid) {
      const mainChat = await this.chatRepo.findOne({ where: { id: chatIdOrPhone } });
      if (mainChat?.telefono) {
        const related = await this.chatRepo.find({ where: { telefono: mainChat.telefono } });
        chatIds = related.map(c => c.id);
      } else {
        chatIds = [chatIdOrPhone];
      }
    } else {
      const cleaned = chatIdOrPhone.replace(/\D/g, '');
      const chats = await this.chatRepo.find({ where: { telefono: cleaned } });
      chatIds = chats.map(c => c.id);
    }

    if (chatIds.length === 0) return [];

    const tresAtras = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    return this.mensajeRepo.find({
      where: { chatId: In(chatIds), createdAt: MoreThan(tresAtras) },
      order: { createdAt: 'ASC' },
      take:  limit,
    });
  }

  // ── Buscar chat por ID ────────────────────────────────────────
  async findChat(chatId: string): Promise<CrmChat | null> {
    return this.chatRepo.findOne({ where: { id: chatId } });
  }

  // ── Buscar waChatId real por número de teléfono ───────────────
  async findWaChatId(telefono: string): Promise<string | null> {
    const chat = await this.chatRepo.findOne({ where: { telefono } });
    return chat?.waChatId ?? null;
  }

  // ── Buscar mensaje por waMsgId (deduplicación) ────────────────
  async findMensajePorWaMsgId(waMsgId: string): Promise<CrmMensaje | null> {
    return this.mensajeRepo.findOne({ where: { waMsgId } });
  }

  // ── Purgar mensajes de más de N días (cron nocturno) ─────────
  async purgarMensajesAntiguos(diasRetención: number): Promise<number> {
    const limite = new Date(Date.now() - diasRetención * 24 * 60 * 60 * 1000);
    const result = await this.mensajeRepo.delete({ createdAt: LessThan(limite) });
    return result.affected ?? 0;
  }
}
