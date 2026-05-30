import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import * as fs   from 'fs';
import * as path from 'path';
import { CrmNativoService } from './crm-nativo.service';
import { CrmNativoGateway } from './crm-nativo.gateway';
import { WaStateService }   from './wa-state.service';

// whatsapp-web.js + qrcode importados dinámicamente para evitar
// errores de arranque si la librería aún no está instalada.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client, LocalAuth } = require('whatsapp-web.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode');

const SESSION_PATH = process.env.WA_SESSION_PATH || '/opt/datafast/.wwebjs_auth';
const CLIENT_ID    = 'datafast-crm';

// Cluster guard: only PM2 instance 0 manages the WA client.
// Reads from env var first, falls back to pm2_env JSON (PM2 v7 embeds it as number).
const IS_PRIMARY = (() => {
  const raw = process.env.NODE_APP_INSTANCE;
  if (raw !== undefined) return raw === '0';
  try {
    const inst = JSON.parse(process.env.pm2_env || '{}').NODE_APP_INSTANCE;
    if (inst !== undefined) return inst === 0;
  } catch {}
  return true; // not under PM2 cluster → always primary
})();

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
  private restarting  = false;

  constructor(
    private readonly crmSvc:  CrmNativoService,
    private readonly gateway: CrmNativoGateway,
    private readonly state:   WaStateService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  onModuleInit(): void {
    if (!IS_PRIMARY) {
      this.logger.log('Instancia secundaria — WaClient delegado a instancia 0');
      return;
    }
    // Non-blocking: let NestJS finish booting before Chrome starts
    setImmediate(() => this.iniciarCliente().catch((err) => this.logger.error(`WA init fatal: ${err?.message}`)));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy().catch(() => {});
    }
  }

  getEstado() {
    return this.state.snapshot();
  }

  // ── Enviar mensaje desde el CRM ────────────────────────────────
  async enviarMensaje(telefono: string, texto: string, agente: string, empresaId: string) {
    if (!this.client || this.state.estado !== 'CONECTADO') {
      throw new Error('WhatsApp Web no está conectado');
    }

    const chatId        = `${telefono.replace(/\D/g, '')}@c.us`;
    const textoConFirma = `*${agente}:* ${texto}`;

    const sentMsg = await this.client.sendMessage(chatId, textoConFirma);
    const msgId   = sentMsg?.id?._serialized ?? null;

    // Persistir el mensaje saliente
    const chat = await this.crmSvc.upsertChat(empresaId, {
      waChatId:       chatId,
      telefono:       telefono.replace(/\D/g, ''),
      nombreContacto: null,
      ultimoMensaje:  textoConFirma,
      ultimoMsgAt:    new Date(),
      noLeidos:       0,
    });

    const msg = await this.crmSvc.guardarMensaje(empresaId, chat.id, {
      waMsgId:   msgId,
      direction: 'OUTBOUND',
      agente,
      body:      textoConFirma,
    });

    this.gateway.emitMensaje({ chatId: chat.id, mensaje: msg });
    this.gateway.emitChatUpdate(chat);

    return { messageId: msgId };
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
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1040472990-alpha.html',
        },
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
          ],
        },
      });

      this.client.on('qr', async (qr: string) => {
        try {
          const qrBase64 = await QRCode.toDataURL(qr);
          this.gateway.emitStatus({ estado: 'REQUERIDO_QR', qr: qrBase64 });
          this.logger.log('QR generado — esperando escaneo');
        } catch (err) {
          this.logger.error(`Error generando QR: ${err}`);
        }
      });

      this.client.on('authenticated', () => {
        this.logger.log('WhatsApp: autenticado — sesión válida');
        // Desbloquear spinner inmediatamente sin esperar ready
        this.gateway.emitStatus({ estado: 'CONECTADO' });
      });

      this.client.on('ready', () => {
        this.logger.log('WhatsApp Web listo!');
        this.gateway.emitStatus({ estado: 'CONECTADO' });
        // Carga de chats históricos en background — no bloquea el spinner
        setImmediate(() => this.cargarChatsIniciales().catch((err) =>
          this.logger.error(`Error cargando chats iniciales: ${err}`),
        ));
      });

      this.client.on('message', async (msg: any) => {
        // Descartar grupos (@g.us), broadcast y mensajes propios
        if (
          msg.from === 'status@broadcast' ||
          msg.from?.endsWith('@g.us') ||
          msg.isGroup ||
          msg.fromMe
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
      const contact  = await msg.getContact();
      const nombre   = contact?.pushname || contact?.name || null;
      const telefono = (msg.from as string).replace('@c.us', '');
      const empresaId = await this.resolverEmpresaId();
      if (!empresaId) return;

      const chat = await this.crmSvc.upsertChat(empresaId, {
        waChatId:       msg.from,
        telefono,
        nombreContacto: nombre,
        ultimoMensaje:  msg.body,
        ultimoMsgAt:    new Date(msg.timestamp * 1000),
        noLeidos:       1,
      });

      const savedMsg = await this.crmSvc.guardarMensaje(empresaId, chat.id, {
        waMsgId:   msg.id?._serialized ?? null,
        direction: 'INBOUND',
        agente:    null,
        body:      msg.body,
      });

      this.gateway.emitMensaje({ chatId: chat.id, mensaje: savedMsg });
      this.gateway.emitChatUpdate(chat);
    } catch (err) {
      this.logger.error(`Error procesando mensaje entrante: ${err}`);
    }
  }

  private async cargarChatsIniciales(): Promise<void> {
    try {
      const waChats  = await this.client.getChats();
      const empresaId = await this.resolverEmpresaId();
      if (!empresaId) return;

      const chats = waChats.filter((c: any) => !c.isGroup && !c.id?._serialized?.endsWith('@g.us')).slice(0, 20);

      for (const c of chats) {
        await this.crmSvc.upsertChat(empresaId, {
          waChatId:       c.id._serialized,
          telefono:       c.id.user,
          nombreContacto: c.name || null,
          ultimoMensaje:  c.lastMessage?.body?.substring(0, 200) ?? null,
          ultimoMsgAt:    c.lastMessage?.timestamp ? new Date(c.lastMessage.timestamp * 1000) : null,
          noLeidos:       (Number.isFinite(c.unreadCount) && c.unreadCount > 0) ? c.unreadCount : 0,
        });
      }

      const saved = await this.crmSvc.listarChats(empresaId);
      this.gateway.emitChats(saved);
    } catch (err) {
      this.logger.error(`Error cargando chats iniciales: ${err}`);
    }
  }

  private async reiniciarConRetraso(ms: number): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    this.logger.log(`Reiniciando cliente WA en ${ms / 1000}s...`);
    await new Promise(r => setTimeout(r, ms));
    this.restarting = false;
    await this.iniciarCliente();
  }

  private async purgarSesionYReiniciar(): Promise<void> {
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    const sessionDir = path.join(SESSION_PATH, `session-${CLIENT_ID}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      this.logger.log('Sesión corrupta eliminada');
    }
    await this.reiniciarConRetraso(3_000);
  }

  // Resuelve el empresaId de la primera empresa activa en la BD
  // (single-tenant: siempre hay una sola empresa)
  private cachedEmpresaId: string | null = null;
  private async resolverEmpresaId(): Promise<string | null> {
    if (!this.cachedEmpresaId) {
      const rows = await this.ds
        .query('SELECT id FROM empresas ORDER BY created_at ASC LIMIT 1')
        .catch(() => []);
      this.cachedEmpresaId = rows[0]?.id ?? null;
    }
    return this.cachedEmpresaId;
  }
}
