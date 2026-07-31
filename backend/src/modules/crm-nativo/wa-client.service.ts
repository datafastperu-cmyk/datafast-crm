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
    const storedChatId = await this.crmSvc.findWaChatId(telefonoLimpio);
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
    const storedChatId   = await this.crmSvc.findWaChatId(telefonoLimpio);
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
      const chatWa     = await this.client.getChatById(waChatId);
      const raw: any[] = await chatWa.fetchMessages({ limit: 100 });
      const limite3m   = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const filtrados  = raw.filter((m: any) => (m.timestamp as number) * 1000 >= limite3m);

      for (const m of filtrados) {
        const saved = await this.crmSvc.guardarMensaje(empresaId, chatDbId, {
          waMsgId:   m.id?._serialized ?? null,
          direction: m.fromMe ? 'OUTBOUND' : 'INBOUND',
          agente:    null,
          body:      m.body || `[${(m.type as string) ?? 'media'}]`,
          mediaUrl:  null,
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
        if (
          msg.from === 'status@broadcast' ||
          msg.from?.endsWith('@g.us') ||
          msg.to?.endsWith('@g.us') ||
          msg.isGroup
        ) return;
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

      if (isOutbound) {
        // Fallback DB: cubre el caso extremo donde llegó tras liberar ambos locks
        if (waMsgId) {
          const existing = await this.crmSvc.findMensajePorWaMsgId(waMsgId);
          if (existing) return;
        }
        // Continúa: mensaje enviado desde el celular físico — procesar como "Desde Celular"
      }

      const empresaId = await this.crmSvc.resolverEmpresaId();
      if (!empresaId) return;

      // Descargar media si existe (voucheres, imágenes, audios)
      let mediaUrl: string | null = null;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media?.data) {
            if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
            const ext      = mimeToExt(media.mimetype);
            const filename = crypto.randomUUID() + ext;
            fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.from(media.data, 'base64'));
            mediaUrl = filename;   // solo el nombre; URL construida en frontend con token
          }
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

  private async cargarChatsIniciales(): Promise<void> {
    let ultimoError: unknown = null;

    for (let intento = 0; intento <= WaClientService.REINTENTOS_CHATS.length; intento++) {
      try {
        const n = await this.intentarCargarChats();
        if (n > 0) {
          this.logger.log(`[CRM] ${n} chats sincronizados desde WhatsApp`);
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

  private async intentarCargarChats(): Promise<number> {
    {
      const todosLosChats = await this.client.getChats();
      const empresaId     = await this.crmSvc.resolverEmpresaId();
      if (!empresaId) {
        throw new Error('No se pudo resolver la empresa (tabla empresas vacía o WA_EMPRESA_ID inválido)');
      }

      const chatsIndividuales = todosLosChats.filter(
        (c: any) => !c.isGroup && !c.id?._serialized?.endsWith('@g.us'),
      );

      for (const c of chatsIndividuales.slice(0, 50)) {
        const contact = await this.client.getContactById(c.id._serialized).catch(() => null);
        const nombre  = (contact as any)?.name || (contact as any)?.pushname || c.name || null;
        await this.crmSvc.upsertChat(empresaId, {
          waChatId:       c.id._serialized,
          telefono:       c.id.user,
          nombreContacto: nombre,
          ultimoMensaje:  c.lastMessage?.body?.substring(0, 200) ?? null,
          ultimoMsgAt:    c.lastMessage?.timestamp ? new Date(c.lastMessage.timestamp * 1000) : null,
          noLeidos:       (Number.isFinite(c.unreadCount) && c.unreadCount > 0) ? c.unreadCount : 0,
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
