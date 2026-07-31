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
  // Una sola sentencia atómica. Antes era leer → mutar en memoria → guardar, con
  // `uq_crm_chat_empresa_id` esperando en la BD: dos mensajes simultáneos del mismo
  // contacto (una ráfaga normal de WhatsApp) chocaban con un 23505 sin manejar y el
  // mensaje se perdía. El contador de no leídos se sumaba sobre el valor leído, así
  // que dos entrantes a la vez dejaban uno solo contado (lost update clásico).
  async upsertChat(empresaId: string, dto: ChatDto): Promise<CrmChat> {
    if (dto.waChatId?.endsWith('@g.us')) return null!;

    // Un LID de Meta son 15+ dígitos y NO es un teléfono: no puede pisar un número
    // ya conocido ni presentarse en la UI como si se pudiera marcar. La bandera
    // describe lo que quedó guardado en `telefono`, no el sufijo del chat: si más
    // adelante se resuelve el número real de un chat @lid, deja de ser opaco.
    const telefonoUtil = !!dto.telefono && dto.telefono.length <= 13;
    const esLid        = !telefonoUtil;
    const incremento   = Number.isFinite(dto.noLeidos) && dto.noLeidos > 0 ? dto.noLeidos : 0;

    const [row] = await this.chatRepo.query(`
      INSERT INTO crm_chats
        (empresa_id, wa_chat_id, telefono, nombre_contacto, ultimo_mensaje, ultimo_msg_at, no_leidos, es_lid)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (empresa_id, wa_chat_id) DO UPDATE SET
        telefono        = CASE WHEN $9 THEN EXCLUDED.telefono ELSE crm_chats.telefono END,
        nombre_contacto = COALESCE(EXCLUDED.nombre_contacto, crm_chats.nombre_contacto),
        ultimo_mensaje  = COALESCE(EXCLUDED.ultimo_mensaje,  crm_chats.ultimo_mensaje),
        ultimo_msg_at   = COALESCE(EXCLUDED.ultimo_msg_at,   crm_chats.ultimo_msg_at),
        no_leidos       = crm_chats.no_leidos + $7,
        es_lid          = CASE WHEN $9 THEN false ELSE crm_chats.es_lid END,
        updated_at      = now()
      RETURNING id, empresa_id AS "empresaId", wa_chat_id AS "waChatId", telefono,
                nombre_contacto AS "nombreContacto", ultimo_mensaje AS "ultimoMensaje",
                ultimo_msg_at AS "ultimoMsgAt", no_leidos AS "noLeidos", es_lid AS "esLid",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `, [
      empresaId,
      dto.waChatId,
      dto.telefono,
      dto.nombreContacto,
      dto.ultimoMensaje,
      dto.ultimoMsgAt,
      incremento,
      esLid,
      telefonoUtil,
    ]);

    return row as CrmChat;
  }

  // ── Guardar mensaje ──────────────────────────────────────────
  // La deduplicación la sostiene `uq_crm_mensajes_wa_msg_id`, no una consulta
  // previa: entre un SELECT y su INSERT caben dos eventos del mismo mensaje.
  // Si ya existía, se devuelve la fila que ya estaba — reprocesar un mensaje es
  // un no-op, no un error.
  async guardarMensaje(
    empresaId: string,
    chatId:    string,
    dto:       MensajeDto,
  ): Promise<CrmMensaje> {
    if (dto.waMsgId) {
      const [row] = await this.mensajeRepo.query(`
        INSERT INTO crm_mensajes (chat_id, empresa_id, wa_msg_id, direction, agente, body, media_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (wa_msg_id) WHERE wa_msg_id IS NOT NULL DO NOTHING
        RETURNING id, chat_id AS "chatId", empresa_id AS "empresaId", wa_msg_id AS "waMsgId",
                  direction, agente, body, media_url AS "mediaUrl", created_at AS "createdAt"
      `, [chatId, empresaId, dto.waMsgId, dto.direction, dto.agente, dto.body, dto.mediaUrl ?? null]);

      if (row) return row as CrmMensaje;

      const existente = await this.mensajeRepo.findOne({
        where: { waMsgId: dto.waMsgId, empresaId },
      });
      if (existente) return existente;
      // Sin fila y sin conflicto localizable: cae al INSERT normal de abajo.
    }

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
  // Con empresa: un chatId de otra empresa no puede marcarse como leído.
  async resetNoLeidos(chatId: string, empresaId: string): Promise<void> {
    await this.chatRepo.update({ id: chatId, empresaId }, { noLeidos: 0 });
  }

  // ── Listar chats (keyset, por última actividad) ───────────────
  // El listado devolvía 500 filas de golpe y sin cursor: con el parque real
  // (505 conversaciones) era una carga completa en cada apertura de la pantalla,
  // y al superar ese número las más antiguas quedaban inalcanzables.
  // Keyset y no OFFSET: la lista se reordena sola cada vez que entra un mensaje,
  // así que paginar por posición duplica y salta conversaciones.
  async listarChats(
    empresaId: string,
    opciones: { limite?: number; cursor?: string | null; busqueda?: string | null } = {},
  ): Promise<{ chats: CrmChat[]; siguienteCursor: string | null }> {
    const limite = Math.min(Math.max(opciones.limite ?? 60, 1), 200);
    const params: unknown[] = [empresaId];
    let filtro = '';

    if (opciones.busqueda) {
      params.push(`%${opciones.busqueda}%`);
      filtro += ` AND (nombre_contacto ILIKE $${params.length} OR telefono ILIKE $${params.length})`;
    }

    // El cursor es la última actividad de la última fila entregada. NULLS LAST en
    // el orden ⇒ los chats sin actividad van al final y se paginan aparte.
    if (opciones.cursor) {
      params.push(opciones.cursor);
      filtro += ` AND ultimo_msg_at IS NOT NULL AND ultimo_msg_at < $${params.length}`;
    }

    params.push(limite + 1);
    const filas: CrmChat[] = await this.chatRepo.query(`
      SELECT id, empresa_id AS "empresaId", wa_chat_id AS "waChatId", telefono,
             nombre_contacto AS "nombreContacto", ultimo_mensaje AS "ultimoMensaje",
             ultimo_msg_at AS "ultimoMsgAt", no_leidos AS "noLeidos", es_lid AS "esLid",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm_chats
      WHERE empresa_id = $1 ${filtro}
      ORDER BY ultimo_msg_at DESC NULLS LAST
      LIMIT $${params.length}
    `, params);

    const hayMas = filas.length > limite;
    const chats  = hayMas ? filas.slice(0, limite) : filas;
    const ultimo = chats[chats.length - 1]?.ultimoMsgAt ?? null;

    return {
      chats,
      siguienteCursor: hayMas && ultimo ? new Date(ultimo).toISOString() : null,
    };
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
  // Todas las consultas van acotadas por empresa: sin ese filtro, un chatId de
  // otra empresa devolvía su conversación completa a cualquier usuario con sesión
  // válida (el controller tampoco comprobaba la propiedad del chat).
  async listarMensajes(chatIdOrPhone: string, empresaId: string, limit = 50): Promise<CrmMensaje[]> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatIdOrPhone);

    let chatIds: string[];
    if (isUuid) {
      const mainChat = await this.chatRepo.findOne({ where: { id: chatIdOrPhone, empresaId } });
      if (!mainChat) return [];
      if (mainChat.telefono && !mainChat.esLid) {
        // Un mismo contacto puede tener chat @lid y @c.us: se fusionan por teléfono.
        // Los LID quedan fuera porque su "teléfono" es un identificador opaco y
        // fusionar por él mezclaría conversaciones de contactos distintos.
        const related = await this.chatRepo.find({
          where: { telefono: mainChat.telefono, empresaId, esLid: false },
        });
        chatIds = related.map(c => c.id);
      } else {
        chatIds = [mainChat.id];
      }
    } else {
      const cleaned = chatIdOrPhone.replace(/\D/g, '');
      const chats = await this.chatRepo.find({ where: { telefono: cleaned, empresaId } });
      chatIds = chats.map(c => c.id);
    }

    if (chatIds.length === 0) return [];

    const tresAtras = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    // Los últimos `limit`, no los primeros: con ASC + take, abrir un chat con
    // historial mostraba la conversación de hace tres meses y ocultaba la de hoy.
    const recientes = await this.mensajeRepo.find({
      where: { chatId: In(chatIds), empresaId, createdAt: MoreThan(tresAtras) },
      order: { createdAt: 'DESC' },
      take:  limit,
    });
    return recientes.reverse();
  }

  // ── Conversaciones recientes que aún no tienen contenido ──────
  // Alimenta la precarga: son las que el operador va a abrir primero.
  async chatsSinMensajes(empresaId: string, limite: number): Promise<{ id: string; waChatId: string }[]> {
    return this.chatRepo.query(`
      SELECT c.id, c.wa_chat_id AS "waChatId"
      FROM crm_chats c
      WHERE c.empresa_id = $1
        AND NOT EXISTS (SELECT 1 FROM crm_mensajes m WHERE m.chat_id = c.id)
      ORDER BY c.ultimo_msg_at DESC NULLS LAST
      LIMIT $2
    `, [empresaId, limite]);
  }

  // ── Registro write-ahead del envío ────────────────────────────
  // Se escribe ANTES de hablar con WhatsApp. Si el proceso muere entre el envío y
  // el guardado, el mensaje que ya salió al cliente deja rastro en vez de
  // desaparecer del ERP y hacer que el operador lo repita.
  async registrarEnvioEnVuelo(
    empresaId: string,
    chatId:    string,
    dto:       { agente: string; body: string; mediaUrl?: string | null },
  ): Promise<CrmMensaje> {
    const msg = this.mensajeRepo.create({
      chatId,
      empresaId,
      waMsgId:     null,
      direction:   'OUTBOUND',
      agente:      dto.agente,
      body:        dto.body,
      mediaUrl:    dto.mediaUrl ?? null,
      estadoEnvio: 'en_vuelo',
    });
    return this.mensajeRepo.save(msg);
  }

  async confirmarEnvio(mensajeId: string, waMsgId: string | null): Promise<CrmMensaje | null> {
    await this.mensajeRepo.update(mensajeId, { waMsgId, estadoEnvio: 'confirmado' });
    return this.mensajeRepo.findOne({ where: { id: mensajeId } });
  }

  // Un timeout NO es un fallo: la operación pudo aplicarse y solo tardar más que
  // el límite del cliente. Se marca aparte para que nadie lo lea como "no salió".
  async marcarEnvioNoConfirmado(
    mensajeId: string,
    estado: 'indeterminado' | 'fallido',
    error: string,
  ): Promise<void> {
    await this.mensajeRepo.update(mensajeId, {
      estadoEnvio: estado,
      errorEnvio:  error.substring(0, 500),
    });
  }

  // ── Mensajes con adjunto que quedó sin descargar ──────────────
  // El historial se carga una sola vez por chat (cuando está vacío), así que un
  // adjunto que no se bajó entonces no se reintentaría jamás. Estos son los que
  // quedaron como el texto "[image]", "[ptt]"… sin archivo detrás.
  async mensajesSinAdjunto(
    empresaId: string,
    limite: number,
  ): Promise<{ id: string; waMsgId: string; chatId: string }[]> {
    return this.mensajeRepo.query(`
      SELECT id, wa_msg_id AS "waMsgId", chat_id AS "chatId"
      FROM crm_mensajes
      WHERE empresa_id = $1
        AND media_url IS NULL
        AND wa_msg_id IS NOT NULL
        AND body IN ('[image]', '[video]', '[audio]', '[ptt]', '[document]', '[sticker]')
      ORDER BY created_at DESC
      LIMIT $2
    `, [empresaId, limite]);
  }

  async asignarMedia(mensajeId: string, filename: string): Promise<void> {
    // El body pasa a llevar el nombre del archivo, igual que en los mensajes en
    // vivo: es lo que el frontend usa para renderizar la imagen.
    await this.mensajeRepo.update(mensajeId, { mediaUrl: filename, body: filename });
  }

  // ── Buscar chat por ID ────────────────────────────────────────
  async findChat(chatId: string, empresaId: string): Promise<CrmChat | null> {
    return this.chatRepo.findOne({ where: { id: chatId, empresaId } });
  }

  // ── Buscar waChatId real por número de teléfono ───────────────
  async findWaChatId(telefono: string, empresaId: string): Promise<string | null> {
    const chat = await this.chatRepo.findOne({ where: { telefono, empresaId, esLid: false } });
    return chat?.waChatId ?? null;
  }

  // ── Buscar mensaje por waMsgId (deduplicación) ────────────────
  async findMensajePorWaMsgId(waMsgId: string, empresaId: string): Promise<CrmMensaje | null> {
    return this.mensajeRepo.findOne({ where: { waMsgId, empresaId } });
  }

  // ── ¿Este adjunto pertenece a la empresa del usuario? ─────────
  // `/media/:filename` servía cualquier archivo del directorio con solo conocer
  // su nombre, sin comprobar de qué conversación —ni de qué empresa— venía.
  async mediaPerteneceAEmpresa(filename: string, empresaId: string): Promise<boolean> {
    const count = await this.mensajeRepo.count({ where: { mediaUrl: filename, empresaId } });
    return count > 0;
  }

  // ── Purgar mensajes de más de N días (cron nocturno) ─────────
  async purgarMensajesAntiguos(diasRetención: number): Promise<number> {
    const limite = new Date(Date.now() - diasRetención * 24 * 60 * 60 * 1000);
    const result = await this.mensajeRepo.delete({ createdAt: LessThan(limite) });
    return result.affected ?? 0;
  }
}
