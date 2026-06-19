import { Injectable, Logger, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { encrypt } from '../../common/utils/encryption.util';
import { GatewayMensajeriaService } from '../notificaciones/services/gateway-mensajeria.service';
import { SYSTEM_DEFAULTS_WHATSAPP } from '../plantillas/plantillas.service';
import { TipoNotificacion }         from '../notificaciones/services/whatsapp.service';

export type ProveedorActivo =
  | 'META_GRAPH'
  | 'TWILIO'
  | 'VONAGE'
  | 'CUSTOM_API'
  | 'AUTOMATIZADO_VIP'
  | 'DATAFAST_MENSAJERIA_MASIVA';

// DATAFAST_NATIVE (whatsapp-web.js) es solo para el CRM interactivo —
// no se acepta como proveedor del gateway de mensajería masiva.
const PROVEEDORES_PUBLICOS = new Set<string>([
  'META_GRAPH', 'TWILIO', 'VONAGE', 'CUSTOM_API',
  'AUTOMATIZADO_VIP', 'DATAFAST_MENSAJERIA_MASIVA',
]);

export interface CronHorarios {
  facturacion:   string;
  corte:         string;
  recordatorio1: string;
  recordatorio2: string;
  recordatorio3: string;
}

const execAsync = promisify(exec);

@Injectable()
export class SistemaService {
  private readonly logger = new Logger(SistemaService.name);

  private readonly appDir:      string;
  private readonly sourceType:  string;
  private readonly sourceUrl:   string;
  private readonly sourceBranch: string;
  private readonly sourceToken: string;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly gateway: GatewayMensajeriaService,
  ) {
    this.appDir       = this.config.get('UPDATE_DIR')            || '/opt/datafast';
    this.sourceType   = this.config.get('UPDATE_SOURCE_TYPE')    || 'git';
    this.sourceUrl    = this.config.get('UPDATE_SOURCE_URL')     || '';
    this.sourceBranch = this.config.get('UPDATE_SOURCE_BRANCH')  || 'main';
    this.sourceToken  = this.config.get('UPDATE_SOURCE_TOKEN')   || '';
  }

  // ─── Versión local ────────────────────────────────────────────
  getCurrentVersion(): string {
    try {
      const versionFile = path.join(this.appDir, 'VERSION');
      if (fs.existsSync(versionFile)) {
        return fs.readFileSync(versionFile, 'utf8').trim();
      }
    } catch {}
    return process.env.npm_package_version || '1.0.0';
  }

  // ─── Versión remota ───────────────────────────────────────────
  async getRemoteVersion(): Promise<string | null> {
    const rawUrl = this.buildRawVersionUrl();
    if (!rawUrl) return null;
    try {
      const text = await this.fetchText(rawUrl);
      return text.trim();
    } catch {
      return null;
    }
  }

  private buildRawVersionUrl(): string | null {
    const url = this.sourceUrl;
    if (!url) return null;

    if (url.includes('github.com')) {
      const match = url.match(/github\.com\/([^\/]+\/[^\/.\s]+)/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1].replace(/\.git$/, '')}/${this.sourceBranch}/VERSION`;
      }
    }

    if (url.includes('gitlab.com')) {
      const match = url.match(/gitlab\.com\/([^\/]+\/[^\/.\s]+)/);
      if (match) {
        return `https://gitlab.com/${match[1].replace(/\.git$/, '')}/-/raw/${this.sourceBranch}/VERSION`;
      }
    }

    // Genérico: fuente ZIP/TAR — intentar URL hermana /VERSION
    if (this.sourceType === 'zip' || this.sourceType === 'tar') {
      const base = url.substring(0, url.lastIndexOf('/'));
      return `${base}/VERSION`;
    }

    return null;
  }

  private fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const options: any = { headers: {} };
      if (this.sourceToken) {
        options.headers['Authorization'] = `Bearer ${this.sourceToken}`;
      }
      client.get(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      }).on('error', reject);
    });
  }

  isNewerVersion(current: string, remote: string): boolean {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [cMaj, cMin, cPat = 0] = parse(current);
    const [rMaj, rMin, rPat = 0] = parse(remote);
    if (rMaj !== cMaj) return rMaj > cMaj;
    if (rMin !== cMin) return rMin > cMin;
    return rPat > cPat;
  }

  // ─── Información del servidor ─────────────────────────────────
  async getServerInfo() {
    const currentVersion = this.getCurrentVersion();
    let remoteVersion: string | null = null;
    let updateAvailable = false;

    try {
      remoteVersion = await this.getRemoteVersion();
      if (remoteVersion) {
        updateAvailable = this.isNewerVersion(currentVersion, remoteVersion);
      }
    } catch {}

    const memUsage = process.memoryUsage();
    let disk: any = null;
    let processes: any[] = [];

    try {
      const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $2,$3,$4,$5}'");
      const [total, used, free, usage] = stdout.trim().split(' ');
      disk = { total, used, free, usage };
    } catch {}

    try {
      const { stdout } = await execAsync('pm2 jlist 2>/dev/null');
      const list = JSON.parse(stdout);
      processes = list.map((p: any) => ({
        name:     p.name,
        status:   p.pm2_env?.status,
        uptime:   p.pm2_env?.pm_uptime,
        restarts: p.pm2_env?.restart_time,
        cpu:      p.monit?.cpu,
        memoryMb: Math.round((p.monit?.memory || 0) / 1024 / 1024),
      }));
    } catch {}

    return {
      version: {
        current:         currentVersion,
        remote:          remoteVersion,
        updateAvailable,
      },
      update: {
        sourceType: this.sourceType,
        sourceUrl:  this.sourceUrl ? '(configurado)' : '(no configurado)',
        branch:     this.sourceBranch,
      },
      system: {
        uptime:    Math.floor(process.uptime()),
        memoryMb:  Math.round(memUsage.rss / 1024 / 1024),
        node:      process.version,
        platform:  process.platform,
        disk,
      },
      processes,
    };
  }

  // ─── Reiniciar servidor ───────────────────────────────────────
  triggerRestart(): void {
    // Ejecutar en background para que la respuesta HTTP llegue antes
    exec('sleep 2 && pm2 restart all', (err) => {
      if (err) this.logger.error(`Error al reiniciar: ${err.message}`);
      else     this.logger.log('PM2 reiniciado correctamente');
    });
    this.logger.log('Reinicio de PM2 programado en 2s');
  }

  // ─── Actualizar sistema ───────────────────────────────────────
  triggerUpdate(): void {
    const scriptPath = '/tmp/datafast_update.sh';
    const backendDir  = `${this.appDir}/backend`;
    const frontendDir = `${this.appDir}/frontend`;

    const pullCmd = this.buildPullCommand();
    if (!pullCmd) {
      throw new Error('UPDATE_SOURCE_URL no está configurado');
    }

    const script = [
      '#!/bin/bash',
      'set -e',
      'echo "[UPDATE] Iniciando actualización..."',
      pullCmd,
      `echo "[UPDATE] Reconstruyendo backend..."`,
      `cd ${backendDir} && npm install --production=false 2>/dev/null || true`,
      `cd ${backendDir} && ./node_modules/.bin/tsc --skipLibCheck --noEmitOnError false 2>/dev/null || true`,
      `echo "[UPDATE] Reconstruyendo frontend..."`,
      `cd ${frontendDir} && npm install 2>/dev/null || true`,
      `cd ${frontendDir} && npm run build 2>/dev/null || true`,
      'echo "[UPDATE] Reiniciando procesos..."',
      'pm2 restart all',
      `echo "[UPDATE] Finalizado: $(date)"`,
    ].join('\n');

    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    exec(`nohup bash ${scriptPath} > /tmp/datafast_update.log 2>&1 &`, (err) => {
      if (err) this.logger.error(`Error al lanzar script de actualización: ${err.message}`);
    });
    this.logger.log('Script de actualización lanzado en background');
  }

  private buildPullCommand(): string | null {
    if (!this.sourceUrl) return null;

    if (this.sourceType === 'git') {
      if (this.sourceToken) {
        // Inyectar token en la URL para repos privados
        const urlWithToken = this.sourceUrl.replace(
          /^(https?:\/\/)/,
          `$1oauth2:${this.sourceToken}@`,
        );
        return `cd ${this.appDir} && git pull "${urlWithToken}" ${this.sourceBranch}`;
      }
      return `cd ${this.appDir} && git pull origin ${this.sourceBranch}`;
    }

    if (this.sourceType === 'zip') {
      return [
        `wget -q -O /tmp/datafast_update.zip "${this.sourceUrl}"`,
        `unzip -o /tmp/datafast_update.zip -d ${this.appDir}`,
        `rm /tmp/datafast_update.zip`,
      ].join(' && ');
    }

    if (this.sourceType === 'tar') {
      return [
        `wget -q -O /tmp/datafast_update.tar.gz "${this.sourceUrl}"`,
        `tar -xzf /tmp/datafast_update.tar.gz -C ${this.appDir}`,
        `rm /tmp/datafast_update.tar.gz`,
      ].join(' && ');
    }

    return null;
  }

  // ─── Crontab — leer y guardar horarios ───────────────────────

  private readonly DEFAULT_HORARIOS: CronHorarios = {
    facturacion:   '05:00',
    corte:         '06:00',
    recordatorio1: '09:00',
    recordatorio2: '12:00',
    recordatorio3: '19:00',
  };

  private readonly CRON_LOCK_MAP: Record<keyof CronHorarios, string> = {
    facturacion:   'facturacion-worker',
    corte:         'corte',
    recordatorio1: 'rec1',
    recordatorio2: 'rec2',
    recordatorio3: 'rec3',
  };

  private async getEjecutoHoy(): Promise<Record<keyof CronHorarios, boolean>> {
    const hoy = new Date().toISOString().split('T')[0];
    const result = {} as Record<keyof CronHorarios, boolean>;
    for (const [campo, lockKey] of Object.entries(this.CRON_LOCK_MAP) as [keyof CronHorarios, string][]) {
      try {
        result[campo] = !!(await this.cache.get(`cron:ran:${lockKey}:${hoy}`));
      } catch {
        result[campo] = false;
      }
    }
    return result;
  }

  async getCronHorarios(empresaId: string): Promise<CronHorarios & { ejecutoHoy: Record<string, boolean> }> {
    const [row] = await this.ds.query(
      `SELECT cron_horarios FROM empresas WHERE id = $1`,
      [empresaId],
    );
    const horarios = { ...this.DEFAULT_HORARIOS, ...(row?.cron_horarios ?? {}) };
    const ejecutoHoy = await this.getEjecutoHoy();
    return { ...horarios, ejecutoHoy };
  }

  async updateCronHorarios(
    empresaId: string,
    horarios: Partial<CronHorarios>,
  ): Promise<CronHorarios & { ejecutoHoy: Record<string, boolean> }> {
    const actual = await this.getCronHorarios(empresaId);
    const nuevo  = { ...this.DEFAULT_HORARIOS, ...actual, ...horarios };

    await this.ds.query(
      `UPDATE empresas SET cron_horarios = $1 WHERE id = $2`,
      [JSON.stringify(nuevo), empresaId],
    );

    // Invalidar cache de horarios para que el cron lea el nuevo valor en el próximo minuto
    for (const key of Object.keys(horarios) as (keyof CronHorarios)[]) {
      await this.cache.del(`cron:horario:${key}`).catch(() => {});
    }

    const ejecutoHoy = await this.getEjecutoHoy();
    return { ...nuevo, ejecutoHoy };
  }

  // ─── WhatsApp config — leer ───────────────────────────────────

  async getWhatsAppConfig(empresaId: string): Promise<{
    phoneId:     string | null;
    businessId:  string | null;
    tokenExists: boolean;
  }> {
    const [row] = await this.ds.query(
      `SELECT whatsapp_phone_id    AS phone_id,
              whatsapp_business_id AS business_id,
              whatsapp_token       AS token
       FROM empresas WHERE id = $1`,
      [empresaId],
    );
    return {
      phoneId:     row?.phone_id    ?? null,
      businessId:  row?.business_id ?? null,
      tokenExists: !!row?.token,
    };
  }

  // ─── WhatsApp config — actualizar ─────────────────────────────
  // Regla del sentinel: si token llega vacío o como '***stored***'
  // no se toca el valor cifrado existente en BD.

  async updateWhatsAppConfig(
    empresaId: string,
    dto: { token?: string; phoneId?: string; businessId?: string },
  ): Promise<{ phoneId: string | null; businessId: string | null; tokenExists: boolean }> {
    const SENTINEL = '***stored***';

    const setClauses: string[] = [];
    const params: any[]        = [empresaId];

    if (dto.phoneId !== undefined) {
      params.push(dto.phoneId || null);
      setClauses.push(`whatsapp_phone_id = $${params.length}`);
    }

    if (dto.businessId !== undefined) {
      params.push(dto.businessId || null);
      setClauses.push(`whatsapp_business_id = $${params.length}`);
    }

    if (dto.token && dto.token !== SENTINEL) {
      params.push(encrypt(dto.token));
      setClauses.push(`whatsapp_token = $${params.length}`);
    }

    if (setClauses.length > 0) {
      await this.ds.query(
        `UPDATE empresas SET ${setClauses.join(', ')} WHERE id = $1`,
        params,
      );
      // Invalidar caché del WhatsAppService para forzar re-lectura
      await this.cache.del(`wa:config:${empresaId}`).catch(() => {});
    }

    return this.getWhatsAppConfig(empresaId);
  }

  // ─── Historial de notificaciones ─────────────────────────────

  async getNotifLogs(
    empresaId: string,
    page    = 1,
    limit   = 20,
    estado?: string,
    tipo?:   string,
  ): Promise<{ items: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const conds: string[] = [`nl.empresa_id = $1`];
    const params: any[]   = [empresaId];

    if (estado) { params.push(estado);  conds.push(`nl.estado_entrega = $${params.length}`); }
    if (tipo)   { params.push(tipo);    conds.push(`nl.tipo_template   = $${params.length}`); }

    const where = conds.join(' AND ');

    const [countRow] = await this.ds.query(
      `SELECT COUNT(*)::int AS total
       FROM notificaciones_logs nl
       WHERE ${where}`,
      params,
    );

    params.push(limit, offset);
    const items = await this.ds.query(
      `SELECT nl.id, nl.contrato_id, nl.empresa_id, nl.telefono, nl.canal,
              nl.tipo_template, nl.estado_entrega,
              nl.provider_message_id, nl.proveedor, nl.error_detalle, nl.created_at,
              co.numero_contrato,
              cl.nombre_completo AS cliente_nombre
       FROM notificaciones_logs nl
       LEFT JOIN contratos co ON co.id = nl.contrato_id AND co.deleted_at IS NULL
       LEFT JOIN clientes  cl ON cl.id = co.cliente_id  AND cl.deleted_at IS NULL
       WHERE ${where}
       ORDER BY nl.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items, total: countRow?.total ?? 0 };
  }

  // ─── Gateway multi-proveedor — leer ─────────────────────────

  async getGatewayConfig(empresaId: string): Promise<{
    proveedorActivo:        ProveedorActivo | null;
    apiKeyStored:           boolean;
    apiSecretStored:        boolean;
    clientId:               string | null;
    pausa:                  number;
    limiteCaracteres:       number;
    codigoPais:             string;
    activo:                 boolean;
    metaGraphActivo:        boolean;
    twilioActivo:           boolean;
    vonageActivo:           boolean;
    customApiActivo:        boolean;
    automatizadoVipActivo:  boolean;
    limiteDiarioMasivo:     number;
    whatsappNumeroOrigen:   string | null;
  }> {
    const [row] = await this.ds.query(
      `SELECT proveedor_activo, gateway_api_key, gateway_api_secret, gateway_client_id,
              gateway_pausa, gateway_limite_caracteres, gateway_codigo_pais, gateway_activo,
              meta_graph_activo, twilio_activo, vonage_activo, custom_api_activo, automatizado_vip_activo,
              gateway_masivo_limite_diario, whatsapp_numero_origen
       FROM empresas WHERE id = $1`,
      [empresaId],
    );
    const ACTIVO_MAP: Record<string, boolean> = {
      META_GRAPH:                 row?.meta_graph_activo       ?? false,
      TWILIO:                     row?.twilio_activo           ?? false,
      VONAGE:                     row?.vonage_activo           ?? false,
      CUSTOM_API:                 row?.custom_api_activo       ?? false,
      AUTOMATIZADO_VIP:           row?.automatizado_vip_activo ?? false,
      DATAFAST_MENSAJERIA_MASIVA: row?.gateway_activo          ?? false,
    };
    const proveedor = (row?.proveedor_activo ?? null) as ProveedorActivo | null;
    return {
      proveedorActivo:       proveedor,
      apiKeyStored:          !!row?.gateway_api_key,
      apiSecretStored:       !!row?.gateway_api_secret,
      clientId:              row?.gateway_client_id               ?? null,
      pausa:                 row?.gateway_pausa                   ?? 2,
      limiteCaracteres:      row?.gateway_limite_caracteres       ?? 1000,
      codigoPais:            row?.gateway_codigo_pais             ?? '+51',
      activo:                proveedor ? (ACTIVO_MAP[proveedor] ?? false) : false,
      metaGraphActivo:       row?.meta_graph_activo       ?? false,
      twilioActivo:          row?.twilio_activo           ?? false,
      vonageActivo:          row?.vonage_activo           ?? false,
      customApiActivo:       row?.custom_api_activo       ?? false,
      automatizadoVipActivo: row?.automatizado_vip_activo ?? false,
      limiteDiarioMasivo:    row?.gateway_masivo_limite_diario ?? 500,
      whatsappNumeroOrigen:  row?.whatsapp_numero_origen        ?? null,
    };
  }

  // ─── Gateway multi-proveedor — actualizar ────────────────────
  async updateGatewayConfig(
    empresaId: string,
    dto: {
      proveedorActivo?:       string;
      apiKey?:                string;
      apiSecret?:             string;
      clientId?:              string;
      pausa?:                 number;
      limiteCaracteres?:      number;
      codigoPais?:            string;
      activo?:                boolean;
      limiteDiarioMasivo?:    number;
      whatsappNumeroOrigen?:  string;
    },
  ): Promise<{
    proveedorActivo: ProveedorActivo; apiKeyStored: boolean; apiSecretStored: boolean;
    clientId: string | null; pausa: number; limiteCaracteres: number; codigoPais: string; activo: boolean;
    metaGraphActivo: boolean; twilioActivo: boolean; vonageActivo: boolean;
    customApiActivo: boolean; automatizadoVipActivo: boolean;
    limiteDiarioMasivo: number; whatsappNumeroOrigen: string | null;
  }> {
    const SENTINEL    = '***stored***';
    const setClauses: string[] = [];
    const params:     any[]    = [empresaId];

    // Resolve target provider for routing `activo` to the correct per-provider column
    let _targetProvider: string | undefined = dto.proveedorActivo;
    if (dto.activo !== undefined && !_targetProvider) {
      const [prow] = await this.ds.query(
        'SELECT proveedor_activo FROM empresas WHERE id = $1', [empresaId],
      ).catch(() => [null]);
      _targetProvider = prow?.proveedor_activo ?? 'META_GRAPH';
    }
    const targetProvider = _targetProvider ?? 'META_GRAPH';

    if (dto.proveedorActivo) {
      if (!PROVEEDORES_PUBLICOS.has(dto.proveedorActivo)) {
        throw new BadRequestException(`Proveedor no válido: ${dto.proveedorActivo}`);
      }
      params.push(dto.proveedorActivo);
      setClauses.push(`proveedor_activo = $${params.length}`);
    }

    // Validar credenciales antes de activar el switch
    if (dto.activo === true) {
      const [current] = await this.ds.query(
        `SELECT gateway_api_key, whatsapp_phone_id, whatsapp_token, whatsapp_numero_origen
         FROM empresas WHERE id = $1`,
        [empresaId],
      );
      const proveedor = targetProvider;

      if (proveedor === 'META_GRAPH') {
        // Requiere Phone ID + Access Token almacenados
        if (!current?.whatsapp_phone_id || !current?.whatsapp_token) {
          throw new BadRequestException(
            'Configure el Phone ID y el Access Token de Meta Graph antes de activar el servicio.',
          );
        }
      } else if (proveedor === 'DATAFAST_MENSAJERIA_MASIVA') {
        // Credencial de MASIVA = número de origen WhatsApp.
        // Acepta el valor en DB o el que viene en este mismo request (evita chicken-and-egg).
        const numOrigen = current?.whatsapp_numero_origen || dto.whatsappNumeroOrigen?.trim();
        if (!numOrigen) {
          throw new BadRequestException(
            'Configure el número de WhatsApp de origen antes de activar DATAFAST Mensajería Masiva.',
          );
        }
      } else {
        // TWILIO, VONAGE, AUTOMATIZADO_VIP, CUSTOM_API requieren api_key almacenada o en este request
        const hasStored = !!current?.gateway_api_key;
        const hasNewKey = !!(dto.apiKey && dto.apiKey !== SENTINEL);
        if (!hasStored && !hasNewKey) {
          throw new BadRequestException(
            `Configure las credenciales de ${proveedor} antes de activar el servicio.`,
          );
        }
      }
    }

    if (dto.apiKey !== undefined && dto.apiKey !== SENTINEL) {
      params.push(dto.apiKey ? encrypt(dto.apiKey) : null);
      setClauses.push(`gateway_api_key = $${params.length}`);
    }

    if (dto.apiSecret !== undefined && dto.apiSecret !== SENTINEL) {
      params.push(dto.apiSecret ? encrypt(dto.apiSecret) : null);
      setClauses.push(`gateway_api_secret = $${params.length}`);
    }

    if (dto.clientId !== undefined) {
      params.push(dto.clientId || null);
      setClauses.push(`gateway_client_id = $${params.length}`);
    }

    if (dto.pausa !== undefined) {
      params.push(Math.max(0, Math.min(60, dto.pausa)));
      setClauses.push(`gateway_pausa = $${params.length}`);
    }

    if (dto.limiteCaracteres !== undefined) {
      params.push(Math.max(50, Math.min(5000, dto.limiteCaracteres)));
      setClauses.push(`gateway_limite_caracteres = $${params.length}`);
    }

    if (dto.codigoPais !== undefined) {
      params.push(dto.codigoPais || '+51');
      setClauses.push(`gateway_codigo_pais = $${params.length}`);
    }

    if (dto.activo !== undefined) {
      const ACTIVO_COL: Record<string, string> = {
        META_GRAPH:                 'meta_graph_activo',
        TWILIO:                     'twilio_activo',
        VONAGE:                     'vonage_activo',
        CUSTOM_API:                 'custom_api_activo',
        AUTOMATIZADO_VIP:           'automatizado_vip_activo',
        DATAFAST_MENSAJERIA_MASIVA: 'gateway_activo',
      };
      const col = ACTIVO_COL[targetProvider] ?? 'gateway_activo';
      params.push(dto.activo);
      setClauses.push(`${col} = $${params.length}`);
    }

    if (dto.limiteDiarioMasivo !== undefined) {
      params.push(Math.max(1, Math.min(10000, dto.limiteDiarioMasivo)));
      setClauses.push(`gateway_masivo_limite_diario = $${params.length}`);
    }

    if (dto.whatsappNumeroOrigen !== undefined) {
      params.push(dto.whatsappNumeroOrigen?.replace(/[^\d+]/g, '') || null);
      setClauses.push(`whatsapp_numero_origen = $${params.length}`);
    }

    if (setClauses.length > 0) {
      await this.ds.query(
        `UPDATE empresas SET ${setClauses.join(', ')} WHERE id = $1`,
        params,
      );
      await this.cache.del(`gw:config:${empresaId}`).catch(() => {});
    }

    return this.getGatewayConfig(empresaId);
  }

  // ─── Log de actualización ────────────────────────────────────
  async getUpdateLog(): Promise<string> {
    try {
      const { stdout } = await execAsync('tail -50 /tmp/datafast_update.log 2>/dev/null || echo "(sin logs)"');
      return stdout;
    } catch {
      return '(sin logs disponibles)';
    }
  }

  // ─── Reenviar notificación fallida/encolada ───────────────────
  async reenviarNotifLog(logId: string, empresaId: string): Promise<{ enviado: boolean; error?: string }> {
    const [log] = await this.ds.query(`
      SELECT nl.id, nl.telefono, nl.tipo_template, nl.contrato_id
      FROM notificaciones_logs nl
      INNER JOIN contratos co ON co.id = nl.contrato_id
      WHERE nl.id = $1 AND co.empresa_id = $2
    `, [logId, empresaId]);

    if (!log) throw new NotFoundException('Log no encontrado');

    const [row] = await this.ds.query(`
      SELECT co.id AS contrato_id, co.empresa_id, co.deuda_total, co.meses_deuda,
             co.usuario_pppoe, co.ip_asignada,
             cl.nombre_completo,
             em.razon_social AS empresa_nombre,
             pl.nombre       AS plan_nombre,
             f.total              AS factura_total,
             f.numero_completo    AS factura_numero,
             f.fecha_vencimiento  AS factura_vencimiento
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id AND cl.deleted_at IS NULL
      JOIN empresas em ON em.id = co.empresa_id
      JOIN planes   pl ON pl.id = co.plan_id
      LEFT JOIN LATERAL (
        SELECT total, numero_completo, fecha_vencimiento
        FROM facturas
        WHERE contrato_id = co.id
          AND estado IN ('emitida', 'pagada_parcial', 'vencida')
          AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      ) f ON true
      WHERE co.id = $1
    `, [log.contrato_id]);

    const resultado = await this.gateway.despachar({
      telefono:   log.telefono,
      tipo:       log.tipo_template as TipoNotificacion,
      variables:  this.buildNotifVariables(log.tipo_template, row),
      empresaId,
      contratoId: log.contrato_id,
    });

    return { enviado: resultado.enviado, error: resultado.error };
  }

  private buildNotifVariables(tipo: string, row: any): Record<string, string> {
    const nombre = row?.nombre_completo ?? '';
    const deuda  = `S/ ${parseFloat(row?.deuda_total || '0').toFixed(2)}`;

    switch (tipo) {
      case TipoNotificacion.FACTURA_EMITIDA:
        return {
          clienteNombre:    nombre,
          numeroFactura:    row?.factura_numero    ?? '—',
          montoTotal:       `S/ ${parseFloat(row?.factura_total || '0').toFixed(2)}`,
          fechaVencimiento: this.fmtFecha(row?.factura_vencimiento),
        };
      case TipoNotificacion.PAGO_VENCE_HOY:
        return { clienteNombre: nombre, montoDeuda: deuda, linkPago: '' };
      case TipoNotificacion.PAGO_VENCIDO:
        return { clienteNombre: nombre, montoDeuda: deuda, diasVencido: String(row?.meses_deuda ?? 0), numeroCuenta: '' };
      case TipoNotificacion.SERVICIO_SUSPENDIDO:
        return { clienteNombre: nombre, deudaTotal: deuda, nombreEmpresa: row?.empresa_nombre ?? '' };
      case TipoNotificacion.SERVICIO_REACTIVADO:
      case TipoNotificacion.SERVICIO_ACTIVADO:
      case TipoNotificacion.BIENVENIDA:
        return { clienteNombre: nombre, planNombre: row?.plan_nombre ?? '', ipAsignada: row?.ip_asignada ?? '', usuarioPppoe: row?.usuario_pppoe ?? '', velocidadBajada: '', velocidadSubida: '' };
      default:
        return { clienteNombre: nombre };
    }
  }

  // ─── Preview del mensaje enviado ────────────────────────────
  // Mapeo tipo_template (TipoNotificacion) → plantillas_mensajes.codigo
  private readonly TIPO_A_PLANTILLA: Record<string, string> = {
    factura_emitida:     'nueva_factura',
    pago_vence_hoy:      'aviso_pago_01',
    pago_vencido:        'aviso_pago_02',
    servicio_suspendido: 'corte_servicio',
    servicio_reactivado: 'reactivacion_servicio',
    servicio_activado:   'activacion_servicio',
    bienvenida:          'bienvenida',
    pago_recibido:       'confirmacion_pago',
    alerta_egreso:       'datafast_alerta_egreso',
  };

  // Formatea un valor Date o string de fecha a DD/MM/YYYY
  private fmtFecha(val: unknown): string {
    if (!val) return '—';
    const s = val instanceof Date
      ? val.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : String(val).substring(0, 10).split('-').reverse().join('/');
    return s;
  }

  async previewNotifLog(logId: string, empresaId: string): Promise<{
    tipo: string; telefono: string; cliente: string; texto: string;
  }> {
    const [log] = await this.ds.query(`
      SELECT nl.id, nl.telefono, nl.tipo_template, nl.contrato_id
      FROM notificaciones_logs nl
      INNER JOIN contratos co ON co.id = nl.contrato_id
      WHERE nl.id = $1 AND co.empresa_id = $2
    `, [logId, empresaId]);

    if (!log) throw new NotFoundException('Log no encontrado');

    const [row] = await this.ds.query(`
      SELECT co.id AS contrato_id, co.empresa_id, co.deuda_total, co.meses_deuda,
             co.usuario_pppoe, co.ip_asignada,
             cl.nombre_completo,
             em.razon_social          AS empresa_nombre,
             em.telefono_informativo  AS empresa_telefono,
             pl.nombre                AS plan_nombre,
             f.total                  AS factura_total,
             f.numero_completo        AS factura_numero,
             f.fecha_vencimiento      AS factura_vencimiento
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id AND cl.deleted_at IS NULL
      JOIN empresas em ON em.id = co.empresa_id
      JOIN planes   pl ON pl.id = co.plan_id
      LEFT JOIN LATERAL (
        SELECT total, numero_completo, fecha_vencimiento
        FROM facturas
        WHERE contrato_id = co.id
          AND estado IN ('emitida', 'pagada_parcial', 'vencida')
          AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      ) f ON true
      WHERE co.id = $1
    `, [log.contrato_id]);

    // Buscar plantilla en DB
    const codigoPlantilla = this.TIPO_A_PLANTILLA[log.tipo_template];
    let texto = '—';

    if (codigoPlantilla) {
      const [plantilla] = await this.ds.query(`
        SELECT contenido FROM plantillas_mensajes
        WHERE empresa_id = $1 AND tipo = 'whatsapp' AND codigo = $2
          AND activo = true AND deleted_at IS NULL
        LIMIT 1
      `, [empresaId, codigoPlantilla]);

      if (plantilla?.contenido) {
        const fechaVenc = this.fmtFecha(row?.factura_vencimiento);
        const montoFact = row?.factura_total
          ? parseFloat(row.factura_total).toFixed(2)
          : parseFloat(row?.deuda_total || '0').toFixed(2);

        const vars: Record<string, string> = {
          // nuevos nombres canónicos
          nombre_cliente:   row?.nombre_completo     ?? '—',
          monto:            montoFact,
          plan:             row?.plan_nombre         ?? '—',
          fecha_vencimiento: fechaVenc,
          numero_factura:   row?.factura_numero      ?? '—',
          empresa:          row?.empresa_nombre      ?? '—',
          telefono_empresa: row?.empresa_telefono    ?? '—',
          usuario_pppoe:    row?.usuario_pppoe       ?? '—',
          ip_asignada:      row?.ip_asignada         ?? '—',
          dias_vencidos:    String(row?.meses_deuda ?? 0),
          // alias legados (para plantillas en DB con nombres anteriores)
          nombre_completo:  row?.nombre_completo     ?? '—',
          monto_factura:    montoFact,
          plan_contratado:  row?.plan_nombre         ?? '—',
          fecha_pago:       fechaVenc,
          deuda_total:      `S/ ${parseFloat(row?.deuda_total || '0').toFixed(2)}`,
          dias_vencimiento: String(row?.meses_deuda ?? 0),
        };

        texto = (plantilla.contenido as string).replace(
          /\{\{(\w+)\}\}/g,
          (_, key) => vars[key] ?? `{{${key}}}`,
        );
      }
    }

    // Fallback a la plantilla del sistema si no hay plantilla personalizada en BD
    if (texto === '—' && codigoPlantilla) {
      const defContenido = SYSTEM_DEFAULTS_WHATSAPP[codigoPlantilla]?.contenido;
      if (defContenido) {
        const fechaV = this.fmtFecha(row?.factura_vencimiento);
        const montoV = row?.factura_total
          ? parseFloat(row.factura_total).toFixed(2)
          : parseFloat(row?.deuda_total || '0').toFixed(2);
        const sysVars: Record<string, string> = {
          nombre_cliente:    row?.nombre_completo  ?? '—',
          empresa:           row?.empresa_nombre   ?? '—',
          telefono_empresa:  row?.empresa_telefono ?? '—',
          plan:              row?.plan_nombre      ?? '—',
          usuario_pppoe:     row?.usuario_pppoe    ?? '—',
          ip_asignada:       row?.ip_asignada      ?? '—',
          monto:             montoV,
          numero_factura:    row?.factura_numero   ?? '—',
          fecha_vencimiento: fechaV,
          dias_vencidos:     String(row?.meses_deuda ?? 0),
        };
        texto = defContenido.replace(/\{\{(\w+)\}\}/g, (_, key: string) => sysVars[key] ?? `{{${key}}}`);
      }
    }

    return {
      tipo:     log.tipo_template,
      telefono: log.telefono,
      cliente:  row?.nombre_completo ?? '—',
      texto,
    };
  }

  // ─── Eliminar log de notificación ────────────────────────────
  async eliminarNotifLog(logId: string, empresaId: string): Promise<void> {
    const [log] = await this.ds.query(`
      SELECT nl.id
      FROM notificaciones_logs nl
      INNER JOIN contratos co ON co.id = nl.contrato_id
      WHERE nl.id = $1 AND co.empresa_id = $2
    `, [logId, empresaId]);

    if (!log) throw new NotFoundException('Log no encontrado');

    await this.ds.query(`DELETE FROM notificaciones_logs WHERE id = $1`, [logId]);
  }
}
