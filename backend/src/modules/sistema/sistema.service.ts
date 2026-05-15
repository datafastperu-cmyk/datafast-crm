import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const execAsync = promisify(exec);

@Injectable()
export class SistemaService {
  private readonly logger = new Logger(SistemaService.name);

  private readonly appDir:      string;
  private readonly sourceType:  string;
  private readonly sourceUrl:   string;
  private readonly sourceBranch: string;
  private readonly sourceToken: string;

  constructor(private readonly config: ConfigService) {
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
