import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository }          from 'typeorm';
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
      mediaUrl:  null,
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
      take:   100,
    });
  }

  // Single-tenant: devuelve todos los chats sin filtrar por empresa
  async listarChatsActivos(): Promise<CrmChat[]> {
    return this.chatRepo.find({
      order: { ultimoMsgAt: 'DESC' },
      take:  100,
    });
  }

  // ── Listar mensajes de un chat ────────────────────────────────
  async listarMensajes(chatId: string, limit = 50): Promise<CrmMensaje[]> {
    return this.mensajeRepo.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
      take:  limit,
    });
  }

  // ── Buscar chat por ID ────────────────────────────────────────
  async findChat(chatId: string): Promise<CrmChat | null> {
    return this.chatRepo.findOne({ where: { id: chatId } });
  }
}
