import { Injectable, Logger, Inject } from '@nestjs/common';
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

export type ProveedorActivo = 'META_GRAPH' | 'TWILIO' | 'VONAGE' | 'CUSTOM_API' | 'AUTOMATIZADO_VIP' | 'DATAFAST_NATIVE';

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

  async getCronHorarios(empresaId: string): Promise<CronHorarios> {
    const [row] = await this.ds.query(
      `SELECT cron_horarios FROM empresas WHERE id = $1`,
      [empresaId],
    );
    return { ...this.DEFAULT_HORARIOS, ...(row?.cron_horarios ?? {}) };
  }

  async updateCronHorarios(
    empresaId: string,
    horarios: Partial<CronHorarios>,
  ): Promise<CronHorarios> {
    const actual = await this.getCronHorarios(empresaId);
    const nuevo  = { ...actual, ...horarios };

    await this.ds.query(
      `UPDATE empresas SET cron_horarios = $1 WHERE id = $2`,
      [JSON.stringify(nuevo), empresaId],
    );

    return nuevo;
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
    const conds: string[] = [`co.empresa_id = $1`, `co.deleted_at IS NULL`];
    const params: any[]   = [empresaId];

    if (estado) { params.push(estado);  conds.push(`nl.estado_entrega = $${params.length}`); }
    if (tipo)   { params.push(tipo);    conds.push(`nl.tipo_template   = $${params.length}`); }

    const where = conds.join(' AND ');

    const [countRow] = await this.ds.query(
      `SELECT COUNT(*)::int AS total
       FROM notificaciones_logs nl
       INNER JOIN contratos co ON co.id = nl.contrato_id
       WHERE ${where}`,
      params,
    );

    params.push(limit, offset);
    const items = await this.ds.query(
      `SELECT nl.id, nl.contrato_id, nl.telefono, nl.canal,
              nl.tipo_template, nl.estado_entrega,
              nl.meta_message_id, nl.error_detalle, nl.created_at,
              co.numero_contrato,
              cl.nombre_completo AS cliente_nombre
       FROM notificaciones_logs nl
       INNER JOIN contratos co ON co.id = nl.contrato_id
       LEFT  JOIN clientes  cl ON cl.id = co.cliente_id AND cl.deleted_at IS NULL
       WHERE ${where}
       ORDER BY nl.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items, total: countRow?.total ?? 0 };
  }

  // ─── Gateway multi-proveedor — leer ─────────────────────────

  async getGatewayConfig(empresaId: string): Promise<{
    proveedorActivo:   ProveedorActivo;
    apiKeyStored:      boolean;
    apiSecretStored:   boolean;
    clientId:          string | null;
    pausa:             number;
    limiteCaracteres:  number;
    codigoPais:        string;
    activo:            boolean;
    limiteDiarioMasivo: number;
  }> {
    const [row] = await this.ds.query(
      `SELECT proveedor_activo, gateway_api_key, gateway_api_secret, gateway_client_id,
              gateway_pausa, gateway_limite_caracteres, gateway_codigo_pais, gateway_activo,
              gateway_masivo_limite_diario
       FROM empresas WHERE id = $1`,
      [empresaId],
    );
    return {
      proveedorActivo:   (row?.proveedor_activo ?? 'META_GRAPH') as ProveedorActivo,
      apiKeyStored:      !!row?.gateway_api_key,
      apiSecretStored:   !!row?.gateway_api_secret,
      clientId:          row?.gateway_client_id          ?? null,
      pausa:             row?.gateway_pausa               ?? 2,
      limiteCaracteres:  row?.gateway_limite_caracteres   ?? 1000,
      codigoPais:        row?.gateway_codigo_pais         ?? '+51',
      activo:            row?.gateway_activo              ?? true,
      limiteDiarioMasivo: row?.gateway_masivo_limite_diario ?? 500,
    };
  }

  // ─── Gateway multi-proveedor — actualizar ────────────────────
  async updateGatewayConfig(
    empresaId: string,
    dto: {
      proveedorActivo?:    string;
      apiKey?:             string;
      apiSecret?:          string;
      clientId?:           string;
      pausa?:              number;
      limiteCaracteres?:   number;
      codigoPais?:         string;
      activo?:             boolean;
      limiteDiarioMasivo?: number;
    },
  ): Promise<{
    proveedorActivo: ProveedorActivo; apiKeyStored: boolean; apiSecretStored: boolean;
    clientId: string | null; pausa: number; limiteCaracteres: number; codigoPais: string; activo: boolean;
    limiteDiarioMasivo: number;
  }> {
    const SENTINEL    = '***stored***';
    const setClauses: string[] = [];
    const params:     any[]    = [empresaId];

    if (dto.proveedorActivo) {
      params.push(dto.proveedorActivo);
      setClauses.push(`proveedor_activo = $${params.length}`);
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
      params.push(dto.activo);
      setClauses.push(`gateway_activo = $${params.length}`);
    }

    if (dto.limiteDiarioMasivo !== undefined) {
      params.push(Math.max(1, Math.min(10000, dto.limiteDiarioMasivo)));
      setClauses.push(`gateway_masivo_limite_diario = $${params.length}`);
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
}
