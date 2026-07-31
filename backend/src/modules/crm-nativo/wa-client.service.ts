import {
  Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';

// Ruta física donde se guardan los archivos de media (dentro del public del backend)
const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/datafast/backend/public/crm_whatsapp';

function mimeToExt(mime: string): string {
  if (mime.startsWith('image/jpeg'))    return '.jpg';
  if (mime.startsWith('image/png'))     return '.png';
  if (mime.startsWith('image/gif'))     return '.gif';
  if (mime.startsWith('image/webp'))    return '.webp';
  if (mime.startsWith('audio/ogg'))     return '.ogg';
  if (mime.startsWith('audio/mpeg'))    return '.mp3';
  if (mime.startsWith('audio/mp4'))     return '.m4a';
  if (mime.startsWith('audio/wav'))     return '.wav';
  if (mime.startsWith('video/mp4'))     return '.mp4';
  if (mime.startsWith('application/pdf')) return '.pdf';
  const sub = mime.split('/')[1]?.split(';')[0] ?? 'bin';
  return '.' + sub;
}
import { CrmNativoService }   from './crm-nativo.service';
import { CrmNativoGateway }   from './crm-nativo.gateway';
import { WaStateService }     from './wa-state.service';
import { ModuleHealthService } from '../../common/services/module-health.service';
import { EventosSistemaService } from '../sistema/eventos-sistema.service';

// whatsapp-web.js + qrcode importados dinámicamente para evitar
// errores de arranque si la librería aún no está instalada.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode');

const SESSION_PATH = process.env.WA_SESSION_PATH || '/opt/datafast/.wwebjs_auth';
const WA_CACHE_PATH = process.env.WA_CACHE_PATH  || '/opt/datafast/.wwebjs_cache';
const CLIENT_ID    = 'datafast-crm';

// Circuit breaker: máximo reinicios antes de pedir intervención manual.
// Delays exponenciales: 8s → 16s → 32s → 64s → 120s
const MAX_RESTARTS   = 5;
const RESTART_DELAYS = [8_000, 16_000, 32_000, 64_000, 120_000];

// Corte por QR no escaneado. El circuit breaker de arriba solo cubre
// 'disconnected' y 'auth_failure'; un cliente que pide QR y nadie escanea NO
// dispara ninguno de los dos: sigue vivo emitiendo un QR cada ~20 s para
// siempre, con Chromium residente. Ocurrió en producción entre el 22/07 y el
// 30/07 de 2026 — 35.369 QR emitidos, cero handshakes, y el ERP reportando
// 'ok' todo el tiempo. A ~20 s por QR, 15 intentos ≈ 5 min de espera real de
// un operador frente a la pantalla; pasado eso nadie va a escanear.
const MAX_QR_SIN_ESCANEAR = 15;

// Tipos de mensaje que llevan un archivo adjunto. El resto (call_log,
// notification_template, revoked, location, interactive…) no tiene nada que bajar.
const TIPOS_CON_ADJUNTO = new Set([
  'image', 'video', 'audio', 'ptt', 'document', 'sticker',
]);

// Adjuntos que se bajan al cargar el historial de un chat (los más recientes).
// Bajar el histórico completo de 514 conversaciones sería un barrido enorme
// contra Chromium y contra el disco del VPS.
const MAX_MEDIA_HISTORIAL = 15;

// Conversaciones cuyo contenido se precarga tras sincronizar, de más reciente a
// más antigua. Son las que el operador abre; el resto se cargan al abrirlas.
const CHATS_PRECARGA      = 25;
// Adjuntos pendientes que se reintentan por pasada.
const MAX_ADJUNTOS_RECUPERAR = 60;
// Pausa entre chats: la precarga corre en segundo plano y no puede competir con
// la atención en vivo por el mismo Chromium.
const PAUSA_PRECARGA_MS   = 400;

// Guard de instancia única: solo UN proceso puede manejar el cliente de WhatsApp,
// porque whatsapp-web.js abre Chromium sobre un perfil de sesión exclusivo.
//
// El guard anterior discriminaba por `NODE_APP_INSTANCE === '0'`, que funciona en PM2
// modo CLUSTER. Pero esta instalación corre en modo FORK con dos apps distintas
// (datafast-api-core y datafast-worker-auxiliary), y PM2 les da NODE_APP_INSTANCE=0 a
// las DOS. Verificado en producción 2026-07-28 leyendo /proc/<pid>/environ: ambos
// procesos se creían primarios, ambos lanzaban Chromium, y api-core moría con
// "Failed to launch the browser process" mientras el worker se quedaba con el perfil.
//
// La discriminación es ahora EXPLÍCITA y de un solo criterio: `WA_ENABLED=true`.
//
// Antes se derivaba de `RUN_CRONS`, lo que ataba el cliente al worker — el mismo
// proceso que corre el outbox de red y los crons de facturación. Es un módulo
// complementario: Chromium no puede competir por la memoria de lo que sí es core
// (el 30/07 el VPS llegó a 87 MB libres). Vive en su propio proceso PM2
// `datafast-whatsapp`, y nginx le enruta /api/v1/crm-nativo/ y /wa-socket/.
//
// Sin la variable puesta, ningún proceso lo arranca: es preferible a que dos
// procesos se peleen el perfil de Chromium, y el estado degradado ahora sí es
// visible en /status.
const IS_PRIMARY = (process.env.WA_ENABLED ?? '').toLowerCase() === 'true';

// Prefer the real Google Chrome binary over the snap wrapper
const CHROME_PATH = process.env.WA_CHROME_PATH
  || (() => {
    for (const p of [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
    ]) {
      try { if (require('fs').existsSync(p)) return p; } catch { /* skip */ }
    }
    return undefined;
  })();

@Injectable()
export class WaClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaClientService.name);
  private client: any = null;
  private restarting   = false;
  private restartCount = 0;
  private qrSinEscanear = 0;
  // Cortado por QR no escaneado: no se relanza solo. Reactivación manual
  // (hoy: `pm2 restart` del proceso que aloja el cliente).
  private detenidoPorQr = false;
  private readonly crmSentIds      = new Set<string>();
  private readonly sendingByChatId = new Set<string>();

  constructor(
    private readonly crmSvc:       CrmNativoService,
    private readonly gateway:      CrmNativoGateway,
    private readonly state:        WaStateService,
    private readonly moduleHealth: ModuleHealthService,
    @Optional() private readonly eventos?: EventosSistemaService,
  ) {}

  onModuleInit(): void {
    if (!IS_PRIMARY) {
      // No se registra salud aquí: este proceso no aloja el cliente, así que no
      // sabe nada de su estado. Antes registraba 'ok' — una afirmación sobre algo
      // que ni siquiera corre en él.
      this.logger.log('Este proceso no aloja el cliente WhatsApp (WA_ENABLED != true)');
      return;
    }
    if (!CHROME_PATH) {
      this.moduleHealth.registrar(
        'crm-whatsapp', 'degraded',
        'Chrome/Chromium no encontrado — instálalo con: apt install google-chrome-stable',
      );
      this.logger.warn('[CrmWhatsapp] Chrome no encontrado — módulo degradado');
      return;
    }
    // Arranque bajo demanda: Chromium solo se levanta solo si hay una sesión
    // previa que reanudar. Sin sesión, arrancar aquí significa emitir QR contra
    // una pantalla que nadie está mirando: se agotan los 15 intentos y el módulo
    // queda cortado justo cuando el operador llega a vincularlo. La vinculación
    // la inicia el operador (`vincular()`), que es cuando el QR sirve de algo.
    if (!this.haySesionEnDisco()) {
      this.moduleHealth.registrar(
        'crm-whatsapp', 'degraded',
        'Sin sesión de WhatsApp vinculada — abre Mensajería › CRM WhatsApp y escanea el QR',
      );
      this.state.setEstado('DESCONECTADO');
      this.logger.log('[WA] Sin sesión en disco — esperando vinculación del operador');
      return;
    }

    this.moduleHealth.registrar('crm-whatsapp', 'ok');
    // Non-blocking: let NestJS finish booting before Chrome starts
    setImmediate(() => this.iniciarCliente().catch((err) => this.logger.error(`WA init fatal: ${err?.message}`)));
  }

  // Marca propia del ERP: se escribe cuando el cliente llega a 'ready' — es decir,
  // cuando la vinculación ocurrió de verdad — y se borra al perderse.
  // NO sirve mirar el directorio de sesión: Chromium lo crea al abrirse aunque
  // nadie escanee nunca el QR, así que "existe el directorio" es cierto también
  // cuando no hay ninguna sesión (comprobado en producción el 31/07).
  private get marcaVinculado(): string {
    return path.join(SESSION_PATH, `.vinculado-${CLIENT_ID}`);
  }

  private haySesionEnDisco(): boolean {
    try {
      return fs.existsSync(this.marcaVinculado);
    } catch {
      return false;
    }
  }

  private marcarVinculado(vinculado: boolean): void {
    try {
      if (vinculado) {
        fs.mkdirSync(SESSION_PATH, { recursive: true });
        fs.writeFileSync(this.marcaVinculado, new Date().toISOString());
      } else if (fs.existsSync(this.marcaVinculado)) {
        fs.unlinkSync(this.marcaVinculado);
      }
    } catch (err: any) {
      this.logger.warn(`[WA] No se pudo actualizar la marca de vinculación: ${err?.message}`);
    }
  }

  // ── Vinculación iniciada por el operador ────────────────────────
  // La ventana de QR empieza a contar AQUÍ, no en el arranque del proceso:
  // es el único momento en que hay alguien mirando la pantalla.
  async vincular(): Promise<{ estado: string; mensaje: string }> {
    this.assertEsHost();

    if (this.state.estado === 'CONECTADO') {
      return { estado: this.state.estado, mensaje: 'WhatsApp ya está vinculado' };
    }
    if (this.state.estado === 'REQUERIDO_QR' && this.client) {
      return { estado: this.state.estado, mensaje: 'Ya hay un QR activo — escanéalo desde el celular' };
    }
    if (!CHROME_PATH) {
      throw new ServiceUnavailableException(
        'Chrome/Chromium no está instalado en el servidor (apt install google-chrome-stable)',
      );
    }

    this.detenidoPorQr  = false;
    this.qrSinEscanear  = 0;
    this.restartCount   = 0;
    this.moduleHealth.registrar('crm-whatsapp', 'ok');
    this.logger.log('[WA] Vinculación solicitada por el operador — iniciando cliente');

    // No se espera al handshake: el QR llega por WebSocket en unos segundos.
    setImmediate(() =>
      this.iniciarCliente().catch(err => this.logger.error(`[WA] vincular: ${err?.message}`)),
    );

    return { estado: 'INICIANDO', mensaje: 'Generando código QR…' };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy().catch(() => {});
    }
  }

  getEstado() {
    return this.state.snapshot();
  }

  // Un proceso que no aloja el cliente no puede opinar sobre WhatsApp. Si una
  // petición llega aquí es un fallo de enrutamiento (nginx manda /crm-nativo/ al
  // proceso datafast-whatsapp), y decirlo así ahorra diagnosticar un
  // "no está conectado" que en realidad significa "preguntaste al proceso equivocado".
  private assertEsHost(): void {
    if (!IS_PRIMARY) {
      throw new ServiceUnavailableException(
        'Este proceso no aloja el cliente de WhatsApp (WA_ENABLED != true). ' +
        'Revisa el enrutamiento de /api/v1/crm-nativo/ hacia el proceso datafast-whatsapp.',
      );
    }
  }

  // ── Enviar mensaje desde el CRM ────────────────────────────────
  async enviarMensaje(telefono: string, texto: string, agente: string, empresaId: string) {
    this.assertEsHost();
    if (!this.client || this.state.estado !== 'CONECTADO') {
      throw new ServiceUnavailableException('WhatsApp Web no está conectado');
    }

    const telefonoLimpio = telefono.replace(/\D/g, '');
    // Prefer the stored waChatId (may be @lid) over assuming @c.us
    const storedChatId = await this.crmSvc.findWaChatId(telefonoLimpio, empresaId);
    let chatId         = storedChatId ?? `${telefonoLimpio}@c.us`;
    const textoConFirma = `*${agente}:* ${texto}`;

    // Resolver el WID canónico vía WA API (puede devolver @lid en lugar de @c.us)
    if (!storedChatId) {
      const resolvedWid = await this.client.pupPage.evaluate(async (cid: string) => {
        try {
          const w = window as any;
          const wid = w.require('WAWebWidFactory').createWid(cid);
          const result = await w.require('WAWebQueryExistsJob').queryWidExists(wid);
          return result?.wid ? String(result.wid) : null;
        } catch { return null; }
      }, chatId).catch(() => null);

      if (!resolvedWid) {
        throw new Error(`El número ${telefono} no está disponible en WhatsApp`);
      }
      // Usar el WID canónico (@lid si corresponde) para evitar duplicar chats @c.us vs @lid
      chatId = resolvedWid;
    }

    // Registrar chatId en lock ANTES de sendMessage — message_create puede disparar
    // mientras sendMessage aún no resolvió, antes de que tengamos el msgId
    this.sendingByChatId.add(chatId);
    const sentMsg = await this.client.sendMessage(chatId, textoConFirma);
    const msgId   = sentMsg?.id?._serialized ?? null;
    if (msgId) this.crmSentIds.add(msgId);

    try {
      const chat = await this.crmSvc.upsertChat(empresaId, {
        waChatId:       chatId,
        telefono:       telefonoLimpio,
        nombreContacto: null,
        ultimoMensaje:  textoConFirma,
        ultimoMsgAt:    new Date(),
        noLeidos:       0,
      });

      const savedMsg = await this.crmSvc.guardarMensaje(empresaId, chat.id, {
        waMsgId:   msgId,
        direction: 'OUTBOUND',
        agente,
        body:      textoConFirma,
      });

      this.gateway.emitMensaje({ chatId: chat.id, mensaje: savedMsg });
      this.gateway.emitChatUpdate(chat);
    } finally {
      this.sendingByChatId.delete(chatId);
      if (msgId) this.crmSentIds.delete(msgId);
    }

    return { messageId: msgId };
  }

  // ── Enviar media (imagen / PDF) desde el CRM ──────────────────
  async enviarMedia(
    rutaFisica:   string,
    filename:     string,
    telefono:     string,
    captionTexto: string,
    agente:       string,
    empresaId:    string,
  ) {
    this.assertEsHost();
    if (!this.client || this.state.estado !== 'CONECTADO') {
      throw new ServiceUnavailableException('WhatsApp Web no está conectado');
    }

    const telefonoLimpio = telefono.replace(/\D/g, '');
    const storedChatId   = await this.crmSvc.findWaChatId(telefonoLimpio, empresaId);
    let chatId           = storedChatId ?? `${telefonoLimpio}@c.us`;

    if (!storedChatId) {
      const resolvedWid = await this.client.pupPage.evaluate(async (cid: string) => {
        try {
          const w = window as any;
          const wid = w.require('WAWebWidFactory').createWid(cid);
          const result = await w.require('WAWebQueryExistsJob').queryWidExists(wid);
          return result?.wid ? String(result.wid) : null;
        } catch { return null; }
      }, chatId).catch(() => null);

      if (!resolvedWid) throw new Error(`El número ${telefono} no está disponible en WhatsApp`);
      chatId = resolvedWid;
    }

    const media   = MessageMedia.fromFilePath(rutaFisica);
    const caption = `*${agente}:* ${captionTexto || ''}`.trimEnd();
    this.sendingByChatId.add(chatId);
    const sentMsg = await this.client.sendMessage(chatId, media, { caption });
    const msgId   = sentMsg?.id?._serialized ?? null;
    if (msgId) this.crmSentIds.add(msgId);

    const tipoLabel = filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Imagen';

    try {
      const chat = await this.crmSvc.upsertChat(empresaId, {
        waChatId:       chatId,
        telefono:       telefonoLimpio,
        nombreContacto: null,
        ultimoMensaje:  `[${tipoLabel}] ${captionTexto || ''}`.trim(),
        ultimoMsgAt:    new Date(),
        noLeidos:       0,
      });

      const savedMsg = await this.crmSvc.guardarMensaje(empresaId, chat.id, {
        waMsgId:   msgId,
        direction: 'OUTBOUND',
        agente,
        body:      caption,
        mediaUrl:  filename,
      });

      this.gateway.emitMensaje({ chatId: chat.id, mensaje: savedMsg });
      this.gateway.emitChatUpdate(chat);
    } finally {
      this.sendingByChatId.delete(chatId);
      if (msgId) this.crmSentIds.delete(msgId);
    }

    return { messageId: msgId, filename };
  }

  // Segunda pasada para los adjuntos que quedaron sin bajar. El historial de un
  // chat se carga una sola vez —cuando está vacío—, así que sin esto un mensaje
  // que quedó como "[image]" no volvería a intentarse nunca.
  private async recuperarAdjuntosPendientes(empresaId: string): Promise<void> {
    const pendientes = await this.crmSvc.mensajesSinAdjunto(empresaId, MAX_ADJUNTOS_RECUPERAR);
    if (pendientes.length === 0) return;

    this.logger.log(`[CRM] Recuperando ${pendientes.length} adjuntos pendientes…`);
    let ok = 0;
    for (const m of pendientes) {
      if (this.state.estado !== 'CONECTADO') break;
      const filename = await this.descargarMediaDeMensaje(m.waMsgId);
      if (filename) {
        await this.crmSvc.asignarMedia(m.id, filename);
        ok++;
      }
      await new Promise(r => setTimeout(r, PAUSA_PRECARGA_MS));
    }
    // Los que no se bajaron suelen ser adjuntos ya caducados en los servidores de
    // WhatsApp: no hay nada que reintentar, y decirlo evita buscar un fallo propio.
    this.logger.log(
      `[CRM] Adjuntos recuperados: ${ok}/${pendientes.length}` +
      `${ok < pendientes.length ? ' (el resto ya no está disponible en WhatsApp)' : ''}`,
    );
  }

  // Persiste un adjunto ya descargado y devuelve su nombre de archivo.
  private guardarMediaEnDisco(media: { data: string; mimetype: string }): string | null {
    try {
      if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
      const filename = crypto.randomUUID() + mimeToExt(media.mimetype);
      fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.from(media.data, 'base64'));
      return filename;
    } catch (err: any) {
      this.logger.warn(`[CRM] No se pudo guardar el adjunto: ${err?.message}`);
      return null;
    }
  }

  // Descarga el adjunto de un mensaje del historial. Va por mensaje individual y
  // con su propio try/catch: un adjunto caducado en el servidor de WhatsApp
  // —habitual en conversaciones viejas— no puede arrastrar al resto del historial.
  private async descargarMediaDeMensaje(waMsgId: string): Promise<string | null> {
    try {
      const msg = await this.client.getMessageById(waMsgId);
      if (!msg?.hasMedia) return null;
      const media = await msg.downloadMedia();
      if (!media?.data) return null;
      return this.guardarMediaEnDisco(media);
    } catch (err: any) {
      this.logger.debug?.(`[CRM] Adjunto no descargable (${waMsgId}): ${err?.message}`);
      return null;
    }
  }

  // Lectura de mensajes de un chat, tolerante a mensajes que no se dejan modelar.
  //
  // `chat.fetchMessages()` de la librería termina en
  // `msgs.map(m => WWebJS.getMessageModel(m))`: un solo mensaje ilegible tira toda
  // la carga con el mismo error minificado ("r") que rompía el listado. Además
  // resuelve el chat vía `createWid`, que falla con los identificadores @lid —
  // por eso el historial nunca se cargó en los chats migrados a LID (31/07/2026).
  //
  // Aquí el chat se toma directamente de la colección por su id, se paginan
  // mensajes antiguos con el mismo mecanismo que usa la librería, y de cada
  // mensaje se extrae solo lo que el CRM guarda, con su propio try/catch.
  private async leerMensajesTolerante(waChatId: string, limite: number): Promise<any[]> {
    return this.client.pupPage.evaluate(async (chatId: string, max: number) => {
      const w = window as any;
      let chat: any;
      try {
        chat = w.require('WAWebCollections').Chat.get(chatId);
      } catch (e: any) {
        return { error: `No se pudo obtener el chat: ${e?.message ?? e}` } as any;
      }
      if (!chat) return { error: 'El chat no está en la colección de WhatsApp Web' } as any;

      const utiles = () => {
        try {
          return (chat.msgs?.getModelsArray?.() ?? []).filter((m: any) => !m.isNotification);
        } catch { return []; }
      };

      // Paginación acotada: cada vuelta pide un bloque anterior. El corte por
      // número de vueltas evita quedarse recorriendo años de conversación.
      for (let vuelta = 0; vuelta < 5 && utiles().length < max; vuelta++) {
        try {
          const previos = await w.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat });
          if (!previos || previos.length === 0) break;
        } catch { break; }
      }

      const salida: any[] = [];
      for (const m of utiles().slice(-max)) {
        try {
          // El id del mensaje: en los modelos del store `_serialized` no siempre
          // viene poblado, y sin él el historial se guardaba con wa_msg_id NULL —
          // los 24 mensajes con imagen quedaron sin identificador, imposibles de
          // localizar para bajar el adjunto y fuera del alcance del índice único
          // que sostiene la deduplicación. Se reconstruye con el formato estándar
          // `fromMe_remote_id` cuando hace falta.
          let serial: string | null = m.id?._serialized ?? null;
          if (!serial && m.id?.id) {
            const remoto = m.id.remote?._serialized ?? m.id.remote ?? chatId;
            serial = `${m.id.fromMe ? 'true' : 'false'}_${remoto}_${m.id.id}`;
          }
          if (!serial && typeof m.id === 'string') serial = m.id;

          salida.push({
            id:        { _serialized: serial },
            body:      typeof m.body === 'string' ? m.body : '',
            type:      m.type ?? null,
            fromMe:    !!(m.id?.fromMe ?? m.fromMe),
            timestamp: typeof m.t === 'number' ? m.t : 0,
            // El tipo es el criterio fiable: en el objeto crudo del store las
            // propiedades de media (mediaData/mediaKey) no siempre están pobladas
            // hasta que WhatsApp resuelve el adjunto, así que mirarlas daba
            // "sin adjunto" para todas las imágenes (31/07/2026: 23 mensajes
            // [image] y 0 descargas).
            tipo:      String(m.type ?? ''),
          });
        } catch { /* este mensaje no se pudo leer: se omite solo él */ }
      }
      return salida as any;
    }, waChatId, limite);
  }

  // ── Carga historial bajo demanda (primer acceso al chat) ─────────
  // Descarga hasta 100 msgs de los últimos 3 meses desde WA y los
  // persiste + emite vía WebSocket.  Solo se llama cuando el chat
  // estaba vacío en el ERP.  Devuelve el nº de mensajes insertados.
  async cargarHistorialEnDB(
    waChatId:  string,
    chatDbId:  string,
    empresaId: string,
  ): Promise<number> {
    if (!this.client || this.state.estado !== 'CONECTADO') return 0;
    try {
      const raw = await this.leerMensajesTolerante(waChatId, 100);
      if (!Array.isArray(raw)) {
        throw new Error((raw as any)?.error ?? 'Lectura de mensajes no devolvió una lista');
      }
      const limite3m   = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const filtrados  = raw.filter((m: any) => (m.timestamp as number) * 1000 >= limite3m);

      // Las imágenes del historial se guardaban como el texto "[image]" y nunca se
      // descargaban: solo se bajaba el adjunto de los mensajes que llegaban en
      // vivo. Resultado: 0 archivos en disco y ninguna imagen visible en chats ya
      // existentes (31/07/2026). Se descargan los más recientes con adjunto —
      // bajar el histórico completo de 514 conversaciones sería un barrido enorme
      // contra Chromium y contra el disco.
      const conMedia = filtrados
        .filter((m: any) => TIPOS_CON_ADJUNTO.has(m.tipo ?? m.type))
        .slice(-MAX_MEDIA_HISTORIAL);
      const idsConMedia = new Set(conMedia.map((m: any) => m.id?._serialized).filter(Boolean));

      for (const m of filtrados) {
        const waMsgId = m.id?._serialized ?? null;
        let mediaUrl: string | null = null;

        if (waMsgId && idsConMedia.has(waMsgId)) {
          mediaUrl = await this.descargarMediaDeMensaje(waMsgId);
        }

        const saved = await this.crmSvc.guardarMensaje(empresaId, chatDbId, {
          waMsgId,
          direction: m.fromMe ? 'OUTBOUND' : 'INBOUND',
          agente:    null,
          // Igual que en los mensajes en vivo: con adjunto, el body lleva el
          // nombre del archivo para que el frontend lo renderice.
          body:      mediaUrl ?? (m.body || `[${(m.type as string) ?? 'media'}]`),
          mediaUrl,
        }).catch(() => null);
        if (saved) this.gateway.emitMensaje({ chatId: chatDbId, mensaje: saved });
      }

      this.logger.log(`[CRM] historial cargado — ${filtrados.length} msgs para ${waChatId}`);
      return filtrados.length;
    } catch (err: any) {
      this.logger.warn(`[CRM] cargarHistorial(${waChatId}) error: ${err?.message}`);
      return 0;
    }
  }

  // ── Inicializar cliente WA ──────────────────────────────────────
  private async iniciarCliente(): Promise<void> {
    // Kill any Chrome processes still holding the session directory (e.g. from a Node crash)
    try {
      require('child_process').execSync(
        `pkill -f "session-${CLIENT_ID}" 2>/dev/null || true`, { stdio: 'ignore' },
      );
      await new Promise(r => setTimeout(r, 1500));
    } catch {}

    // Remove Chrome's SingletonLock if left by a previous crashed process
    try {
      const lock = path.join(SESSION_PATH, `session-${CLIENT_ID}`, 'SingletonLock');
      if (fs.existsSync(lock)) { fs.unlinkSync(lock); this.logger.log('SingletonLock eliminado'); }
    } catch {}

    this.gateway.emitStatus({ estado: 'INICIANDO' });
    this.logger.log('Iniciando cliente WhatsApp Web (whatsapp-web.js)...');

    try {
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: SESSION_PATH,
          clientId: CLIENT_ID,
        }),
        webVersionCache: { type: 'local', path: WA_CACHE_PATH },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        puppeteer: {
          headless: true,
          executablePath: CHROME_PATH,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--disable-blink-features=AutomationControlled',
            '--disable-gpu',
            '--disable-webgl',
          ],
        },
      });

      this.client.on('qr', async (qr: string) => {
        this.qrSinEscanear++;
        if (this.qrSinEscanear > MAX_QR_SIN_ESCANEAR) {
          await this.detenerPorQrNoEscaneado();
          return;
        }
        try {
          const qrBase64 = await QRCode.toDataURL(qr);
          this.gateway.emitStatus({ estado: 'REQUERIDO_QR', qr: qrBase64 });
          this.logger.log(`QR generado — esperando escaneo (${this.qrSinEscanear}/${MAX_QR_SIN_ESCANEAR})`);
        } catch (err) {
          this.logger.error(`Error generando QR: ${err}`);
        }
      });

      this.client.on('authenticated', () => {
        this.restartCount   = 0;
        this.qrSinEscanear  = 0;
        this.logger.log('WhatsApp: autenticado — sesión válida');
        this.gateway.emitStatus({ estado: 'CONECTADO' });
      });

      this.client.on('ready', () => {
        this.restartCount  = 0;
        this.qrSinEscanear = 0;
        this.moduleHealth.registrar('crm-whatsapp', 'ok');
        this.marcarVinculado(true);
        this.logger.log('WhatsApp Web listo!');
        this.gateway.emitStatus({ estado: 'CONECTADO' });
        this.aplicarLidPatches();
        setImmediate(() => this.cargarChatsIniciales().catch((err) =>
          this.logger.error(`Error cargando chats iniciales: ${err}`),
        ));
      });

      // message_create captura INBOUND + mensajes enviados desde el celular físico (fromMe)
      this.client.on('message_create', async (msg: any) => {
        if (!WaClientService.esConversacionIndividual(msg)) return;
        await this.procesarMensajeEntrante(msg);
      });

      this.client.on('disconnected', async (reason: string) => {
        this.logger.warn(`WA desconectado: ${reason}`);
        this.gateway.emitStatus({ estado: 'DESCONECTADO' });
        await this.reiniciarConRetraso(8_000);
      });

      this.client.on('auth_failure', async (msg: string) => {
        this.logger.error(`WA auth_failure: ${msg} — purging session`);
        await this.purgarSesionYReiniciar();
      });

      await this.client.initialize();
    } catch (err: any) {
      this.logger.error(`Error inicializando WA: ${err?.message}`);
      await this.reiniciarConRetraso(15_000);
    }
  }

  // El CRM solo gestiona conversaciones uno a uno. El filtro anterior descartaba
  // grupos y `status@broadcast`, pero no las LISTAS DE DIFUSIÓN, cuyo id es
  // `<numero>@broadcast`: en la primera vinculación real (31/07/2026) entraron 10
  // listas —"CLIENTES MOROSOS CORTE", "15 de cada mes"— como si fueran clientes,
  // con el id de la lista guardado en la columna `telefono`.
  // Los canales (`@newsletter`) son igual de inválidos como chat de atención.
  private static esConversacionIndividual(msg: any): boolean {
    if (msg?.isGroup) return false;
    const partes = [msg?.from, msg?.to].filter(Boolean).map(String);
    return !partes.some(p =>
      p.endsWith('@g.us') || p.endsWith('@broadcast') || p.endsWith('@newsletter'),
    );
  }

  private async procesarMensajeEntrante(msg: any): Promise<void> {
    try {
      const isOutbound = !!msg.fromMe;
      const peerWid    = isOutbound ? (msg.to as string) : (msg.from as string);
      const waMsgId    = msg.id?._serialized ?? null;

      // Filtro CRM ANTES de cualquier await:
      // sendingByChatId cubre el caso en que message_create dispara ANTES de que sendMessage resuelva
      // crmSentIds cubre el caso en que ya tenemos el msgId pero el DB save aún no terminó
      if (isOutbound) {
        if (this.sendingByChatId.has(peerWid)) return;
        if (waMsgId && this.crmSentIds.has(waMsgId)) return;
      }

      // Extraer número real: primero desde from/to, luego resolver LID si aplica
      const rawId = peerWid;
      let telefonoReal = rawId.split('@')[0];

      // Para cuentas Meta migradas a LID: getContactById puede devolver contact.number real
      if (rawId.endsWith('@lid')) {
        try {
          const contactInfo = await this.client.getContactById(rawId);
          if (contactInfo?.number && contactInfo.number !== telefonoReal) {
            telefonoReal = contactInfo.number;
          }
        } catch {}
      }

      const contact = await this.client.getContactById(peerWid).catch(() => null)
                   ?? await msg.getContact().catch(() => null);
      // name = guardado en agenda del celular; pushname = perfil WA del contacto
      const nombre   = contact?.name || contact?.pushname || null;
      const telefono = telefonoReal.replace(/\D/g, '');

      const empresaId = await this.crmSvc.resolverEmpresaId();
      if (!empresaId) return;

      if (isOutbound) {
        // Fallback DB: cubre el caso extremo donde llegó tras liberar ambos locks
        if (waMsgId) {
          const existing = await this.crmSvc.findMensajePorWaMsgId(waMsgId, empresaId);
          if (existing) return;
        }
        // Continúa: mensaje enviado desde el celular físico — procesar como "Desde Celular"
      }

      // Descargar media si existe (voucheres, imágenes, audios)
      let mediaUrl: string | null = null;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          // solo el nombre; la URL la construye el frontend con su token
          if (media?.data) mediaUrl = this.guardarMediaEnDisco(media);
        } catch (e) {
          this.logger.warn(`No se pudo descargar media: ${e}`);
        }
      }

      // Si hay media, el body lleva la URL pública para que el frontend la renderice directamente
      const bodyText = mediaUrl ?? msg.body ?? '';

      const chat = await this.crmSvc.upsertChat(empresaId, {
        waChatId:       peerWid,
        telefono,
        nombreContacto: nombre,
        ultimoMensaje:  bodyText,
        ultimoMsgAt:    new Date(msg.timestamp * 1000),
        noLeidos:       isOutbound ? 0 : 1,
      });

      const savedMsg = await this.crmSvc.guardarMensaje(empresaId, chat.id, {
        waMsgId,
        direction: isOutbound ? 'OUTBOUND' : 'INBOUND',
        agente:    isOutbound ? 'Desde Celular' : null,
        body:      bodyText,
        mediaUrl,
      });

      this.gateway.emitMensaje({ chatId: chat.id, mensaje: savedMsg });
      this.gateway.emitChatUpdate(chat);
    } catch (err) {
      this.logger.error(`Error procesando mensaje: ${err}`);
    }
  }

  // `getChats()` justo tras 'ready' falla con un error minificado ("r: r"): el
  // store interno de WhatsApp Web todavía no está poblado. Visto el 31/07/2026 en
  // la primera vinculación real — la sesión quedó CONECTADA y sin un solo chat en
  // BD, sin más rastro que esa línea. Se reintenta con backoff y, si aun así no
  // hay chats, se dice explícitamente en vez de dejar la pantalla vacía sin causa.
  private static readonly REINTENTOS_CHATS = [3_000, 6_000, 12_000, 20_000];

  // Resincronización a petición del operador: hasta ahora el listado solo se leía
  // en el evento 'ready', así que un fallo de sincronización obligaba a reiniciar
  // el proceso para reintentarlo.
  async sincronizarChats(): Promise<{ chats: number }> {
    this.assertEsHost();
    if (!this.client || this.state.estado !== 'CONECTADO') {
      throw new ServiceUnavailableException('WhatsApp Web no está conectado');
    }
    const chats = await this.intentarCargarChats();
    this.logger.log(`[CRM] Sincronización manual: ${chats} chats`);
    void this.precargarRecientes();
    return { chats };
  }

  // Precarga en segundo plano del contenido de las conversaciones más recientes.
  // Sin esto, el operador abre un chat y espera a que WhatsApp entregue el
  // historial: justo en los chats que más se abren, que son los de hoy.
  private precargando = false;
  private async precargarRecientes(): Promise<void> {
    if (this.precargando) return;
    this.precargando = true;
    try {
      const empresaId = await this.crmSvc.resolverEmpresaId();
      if (!empresaId) return;

      const pendientes = await this.crmSvc.chatsSinMensajes(empresaId, CHATS_PRECARGA);

      if (pendientes.length > 0) {
        this.logger.log(`[CRM] Precargando ${pendientes.length} conversaciones recientes…`);
        let cargados = 0;
        for (const chat of pendientes) {
          if (this.state.estado !== 'CONECTADO') break;
          const n = await this.cargarHistorialEnDB(chat.waChatId, chat.id, empresaId);
          if (n > 0) cargados++;
          await new Promise(r => setTimeout(r, PAUSA_PRECARGA_MS));
        }
        this.logger.log(`[CRM] Precarga terminada: ${cargados}/${pendientes.length} con historial`);
      }

      // Fuera del bloque anterior a propósito: los adjuntos pendientes son de
      // chats que YA tienen mensajes, así que salir antes por "no hay chats que
      // precargar" dejaba las imágenes sin recuperar para siempre.
      await this.recuperarAdjuntosPendientes(empresaId);
    } catch (err: any) {
      this.logger.warn(`[CRM] Precarga interrumpida: ${err?.message}`);
    } finally {
      this.precargando = false;
    }
  }

  private async cargarChatsIniciales(): Promise<void> {
    let ultimoError: unknown = null;

    for (let intento = 0; intento <= WaClientService.REINTENTOS_CHATS.length; intento++) {
      try {
        const n = await this.intentarCargarChats();
        if (n > 0) {
          this.logger.log(`[CRM] ${n} chats sincronizados desde WhatsApp`);
          void this.precargarRecientes();
          return;
        }
        ultimoError = null;
        this.logger.warn(`[CRM] WhatsApp devolvió 0 chats (intento ${intento + 1})`);
      } catch (err) {
        ultimoError = err;
        this.logger.warn(
          `[CRM] getChats falló (intento ${intento + 1}): ${(err as Error)?.message ?? err}`,
        );
      }

      const espera = WaClientService.REINTENTOS_CHATS[intento];
      if (espera === undefined) break;
      await new Promise(r => setTimeout(r, espera));
    }

    const detalle = ultimoError
      ? `getChats falló tras ${WaClientService.REINTENTOS_CHATS.length + 1} intentos: ${(ultimoError as Error)?.message ?? ultimoError}`
      : 'WhatsApp no devolvió ningún chat: la sesión está vinculada pero sin conversaciones sincronizadas';

    this.logger.error(`[CRM] ${detalle}`);
    void this.eventos?.registrar({
      nivel:    'warn',
      origen:   'whatsapp',
      codigo:   'WA_SIN_CHATS_INICIALES',
      mensaje:  detalle,
      stack:    (ultimoError as Error)?.stack ?? null,
    });
    // Los mensajes entrantes siguen entrando por 'message_create', así que el
    // módulo NO está caído: solo le falta el historial previo a la vinculación.
  }

  // Lectura del listado tolerante a chats individuales rotos.
  //
  // `client.getChats()` de whatsapp-web.js 1.34 mapea TODOS los chats con
  // `getChatModel` dentro de un `Promise.all`: basta con que uno falle —una lista
  // de difusión, un canal, un chat con metadatos incompletos— para que se caiga la
  // sincronización entera con un error minificado ("r"). Eso dejó el CRM con solo
  // los chats que tuvieron actividad nueva: 22 de un parque mucho mayor (31/07/2026).
  //
  // Aquí se lee la colección directamente y se extrae, chat por chat y con su
  // propio try/catch, únicamente lo que el CRM necesita. Un chat ilegible se
  // pierde solo a sí mismo.
  private async leerChatsTolerante(): Promise<any[]> {
    return this.client.pupPage.evaluate(() => {
      const w = window as any;
      const salida: any[] = [];
      let modelos: any[] = [];
      try {
        modelos = w.require('WAWebCollections').Chat.getModelsArray() ?? [];
      } catch (e: any) {
        return { error: `No se pudo leer la colección de chats: ${e?.message ?? e}` } as any;
      }

      for (const chat of modelos) {
        try {
          const id = chat?.id?._serialized ?? String(chat?.id ?? '');
          if (!id) continue;

          let ultimoMensaje: string | null = null;
          let ultimoTs: number | null = null;
          try {
            const last = chat.msgs?.getModelsArray?.()?.slice(-1)?.[0];
            if (last) {
              ultimoMensaje = typeof last.body === 'string' ? last.body.substring(0, 200) : null;
              ultimoTs      = typeof last.t === 'number' ? last.t : null;
            }
          } catch { /* chat sin mensajes accesibles */ }

          if (ultimoTs === null && typeof chat.t === 'number') ultimoTs = chat.t;

          salida.push({
            id,
            user:        chat?.id?.user ?? id.split('@')[0],
            isGroup:     !!chat.isGroup,
            nombre:      chat.name ?? chat.formattedTitle ?? chat.contact?.pushname ?? null,
            unreadCount: typeof chat.unreadCount === 'number' ? chat.unreadCount : 0,
            ultimoMensaje,
            ultimoTs,
          });
        } catch { /* este chat no se pudo leer: se omite solo él */ }
      }
      return salida as any;
    });
  }

  private async intentarCargarChats(): Promise<number> {
    {
      const leidos = await this.leerChatsTolerante();
      if (!Array.isArray(leidos)) {
        throw new Error((leidos as any)?.error ?? 'Lectura de chats no devolvió una lista');
      }

      const todosLosChats = leidos
        .filter(c => !c.isGroup)
        .filter(c => WaClientService.esConversacionIndividual({ from: c.id }))
        .map(c => ({
          id:          { _serialized: c.id, user: c.user },
          name:        c.nombre,
          unreadCount: c.unreadCount,
          lastMessage: c.ultimoMensaje !== null || c.ultimoTs !== null
            ? { body: c.ultimoMensaje ?? '', timestamp: c.ultimoTs }
            : undefined,
        }));
      const empresaId     = await this.crmSvc.resolverEmpresaId();
      if (!empresaId) {
        throw new Error('No se pudo resolver la empresa (tabla empresas vacía o WA_EMPRESA_ID inválido)');
      }

      // Sin recorte a 50: ese límite dejaba fuera el resto del parque y no había
      // segunda pasada que los recuperase. El nombre sale del propio store; pedir
      // `getContactById` por chat era un viaje a Chromium por cada uno.
      for (const c of todosLosChats) {
        await this.crmSvc.upsertChat(empresaId, {
          waChatId:       c.id._serialized,
          telefono:       c.id.user,
          nombreContacto: c.name ?? null,
          ultimoMensaje:  c.lastMessage?.body?.substring(0, 200) || null,
          ultimoMsgAt:    c.lastMessage?.timestamp ? new Date(c.lastMessage.timestamp * 1000) : null,
          // La sincronización refleja el contador de WhatsApp; no puede sumarse al
          // que ya hay en BD o cada pasada inflaría los no leídos.
          noLeidos:       0,
        });
      }

      const saved = await this.crmSvc.listarChats(empresaId);
      this.gateway.emitChats(saved);
      return saved.length;
    }
  }

  // ── Corte por QR no escaneado ───────────────────────────────────
  // Libera Chromium y deja el módulo en DEGRADED con constancia auditable.
  // No relanza: si nadie escaneó en 15 QR, reintentar solo vuelve al bucle.
  private async detenerPorQrNoEscaneado(): Promise<void> {
    if (this.detenidoPorQr) return;
    this.detenidoPorQr = true;

    const razon =
      `Vinculación no completada: ${MAX_QR_SIN_ESCANEAR} QR emitidos sin escaneo. ` +
      `Cliente detenido para liberar Chromium — reactivar reiniciando el proceso y escaneando el QR.`;

    this.logger.error(`[WA] ${razon}`);
    this.moduleHealth.registrar('crm-whatsapp', 'degraded', razon);
    // Sin vinculación: que el próximo arranque del proceso no vuelva a emitir QR
    // en vacío y se coma la ventana antes de que llegue el operador.
    this.marcarVinculado(false);
    this.gateway.emitStatus({ estado: 'DESCONECTADO' });

    void this.eventos?.registrar({
      nivel:    'error',
      origen:   'whatsapp',
      codigo:   'WA_QR_NO_ESCANEADO',
      mensaje:  razon,
      contexto: { qrEmitidos: this.qrSinEscanear, maximo: MAX_QR_SIN_ESCANEAR },
    });

    if (this.client) {
      await this.client.destroy().catch((err: any) =>
        this.logger.warn(`[WA] destroy tras corte por QR: ${err?.message}`),
      );
      this.client = null;
    }
  }

  private async reiniciarConRetraso(ms: number): Promise<void> {
    if (this.detenidoPorQr) return;
    if (this.restarting) return;
    if (this.restartCount >= MAX_RESTARTS) {
      this.logger.error(
        `[WA] Máximo de reinicios (${MAX_RESTARTS}) alcanzado — se requiere intervención manual`,
      );
      this.gateway.emitStatus({ estado: 'DESCONECTADO' });
      return;
    }
    this.restarting = true;
    this.restartCount++;
    const delay = RESTART_DELAYS[this.restartCount - 1] ?? ms;
    this.logger.log(`[WA] Reinicio ${this.restartCount}/${MAX_RESTARTS} en ${delay / 1000}s…`);
    await new Promise(r => setTimeout(r, delay));
    this.restarting = false;
    await this.iniciarCliente();
  }

  private async purgarSesionYReiniciar(): Promise<void> {
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    this.marcarVinculado(false);
    const sessionDir = path.join(SESSION_PATH, `session-${CLIENT_ID}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      this.logger.log('Sesión corrupta eliminada');
    }
    this.restartCount = 0;
    await this.reiniciarConRetraso(3_000);
  }

  // Resuelve el empresaId de la primera empresa activa en la BD
  // (single-tenant: siempre hay una sola empresa)
  // Meta migró cuentas WhatsApp Business al esquema LID (Linked Identity Device).
  // WID @c.us legacy falla con "No LID for user" si el LID no está en el Contact store de WA Web.
  // Este patch pre-resuelve el LID vía queryWidExists y reintenta si falla.
  // Aplica a whatsapp-web.js 1.34.x — parches 1 (webpack scan) y 2 (WAWebSendMsgChatAction)
  // eliminados: Patch1 era no-op, Patch2 silenciaba mensajes sin enviarlos (data loss).
  private aplicarLidPatches(): void {
    this.client.pupPage.evaluate(() => {
      if ((window as any)._wwebjsPatched) return;
      (window as any)._wwebjsPatched = true;

      const w        = window as any;
      const prefsMod = w.require?.('WAWebUserPrefsMeUser');
      const origSend = w.WWebJS?.sendMessage;
      if (!origSend) return;

      w.WWebJS.sendMessage = async (chat: any, content: any, options: any) => {
        try {
          const result = await w.require('WAWebQueryExistsJob').queryWidExists(chat.id);
          if (result?.lid) {
            try {
              const contacts = w.require('WAWebCollections').Contact;
              const contact  = contacts.get(chat.id) || contacts.gadd(chat.id);
              if (contact && !contact.lid) contact.lid = result.lid;
            } catch {}
          }
          await new Promise(r => setTimeout(r, 200));
        } catch {}

        try {
          return await origSend(chat, content, options);
        } catch (e: any) {
          if (!String(e?.message).includes('No LID')) throw e;

          const meUser = prefsMod?.getMaybeMePnUser?.();
          await Promise.all([
            meUser
              ? w.require('WAWebQueryExistsJob').queryWidExists(meUser).catch(() => {})
              : Promise.resolve(),
            w.require('WAWebQueryExistsJob').queryWidExists(chat.id).catch(() => {}),
          ]);
          await new Promise(r => setTimeout(r, 500));
          return origSend(chat, content, options);
        }
      };
    })
    .then(() => this.logger.log('[WA] LID patch aplicado correctamente'))
    .catch((err: any) => this.logger.warn(`[WA] LID patch falló: ${err?.message}`));
  }

}
