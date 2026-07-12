import {
  Injectable, Logger, NotFoundException, Inject, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createSign } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

import { Backup, EstadoBackup, TipoBackup, EstadoSubida } from './backup.entity';
import { ModuleHealthService } from '../../common/services/module-health.service';
import { EmpresaConfigService } from '../config/empresa-config.service';

const execAsync = promisify(exec);

export interface BackupConfig {
  habilitado:       boolean;
  horario:          string;
  retencion:        number;
  directorioLocal:  string;
  contenido:        string[];
  drive: {
    habilitado:        boolean;
    credencialesJson:  string;
    carpetaId:         string;
  };
}

const DEFAULT_CONFIG: BackupConfig = {
  habilitado:      false,
  horario:         '02:00',
  retencion:       10,
  directorioLocal: '/opt/datafast/backups',
  contenido:       ['db', 'config', 'uploads'],
  drive:  { habilitado: false, credencialesJson: '', carpetaId: '' },
};

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @InjectRepository(Backup)
    private readonly repo: Repository<Backup>,
    @InjectDataSource()
    private readonly ds: DataSource,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly moduleHealth: ModuleHealthService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly empresaConfig: EmpresaConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await execAsync('which pg_dump');
      this.moduleHealth.registrar('backup', 'ok');
    } catch {
      this.moduleHealth.registrar(
        'backup', 'degraded',
        'pg_dump no encontrado — backups de base de datos deshabilitados (instala postgresql-client)',
      );
    }

    const tz = await this.empresaConfig.getTimezone().catch(() => 'America/Lima');
    const job = new CronJob('* * * * *', () => this.cronBackupDiario(), null, true, tz);
    this.schedulerRegistry.addCronJob('auto-backup-diario', job);
  }

  private get appDir(): string {
    return this.config.get<string>('UPDATE_DIR') || '/opt/datafast';
  }

  // ─── Configuración ────────────────────────────────────────────

  async getConfig(empresaId: string): Promise<BackupConfig> {
    const [row] = await this.ds.query(
      `SELECT backup_config FROM empresas WHERE id = $1`,
      [empresaId],
    );
    return { ...DEFAULT_CONFIG, ...(row?.backup_config ?? {}) };
  }

  async updateConfig(empresaId: string, partial: Partial<BackupConfig>): Promise<BackupConfig> {
    const actual = await this.getConfig(empresaId);
    const nuevo: BackupConfig = { ...actual, ...partial };
    if (partial.drive)  nuevo.drive  = { ...actual.drive,  ...partial.drive  };

    await this.ds.query(
      `UPDATE empresas SET backup_config = $1 WHERE id = $2`,
      [JSON.stringify(nuevo), empresaId],
    );
    return nuevo;
  }

  // ─── Listar / Obtener ─────────────────────────────────────────

  async listar(empresaId: string, limit = 20, offset = 0) {
    const [items, total] = await this.repo.findAndCount({
      where:  { empresaId },
      order:  { createdAt: 'DESC' },
      take:   limit,
      skip:   offset,
    });
    return { items, total };
  }

  async obtener(id: string, empresaId: string): Promise<Backup> {
    const b = await this.repo.findOne({ where: { id, empresaId } });
    if (!b) throw new NotFoundException('Backup no encontrado');
    return b;
  }

  // ─── Eliminar ─────────────────────────────────────────────────

  async eliminar(id: string, empresaId: string): Promise<void> {
    const backup = await this.obtener(id, empresaId);
    if (backup.archivoLocal && fs.existsSync(backup.archivoLocal)) {
      fs.unlinkSync(backup.archivoLocal);
    }
    await this.repo.delete({ id });
  }

  // ─── Crear backup ─────────────────────────────────────────────

  async crearBackup(
    empresaId: string,
    tipo: TipoBackup,
    creadoPor = 'sistema',
  ): Promise<Backup> {
    const cfg = await this.getConfig(empresaId);

    const backup = this.repo.create({
      empresaId,
      tipo,
      estado:       EstadoBackup.EN_PROGRESO,
      contenido:    cfg.contenido,
      creadoPor,
      driveEstado:  cfg.drive.habilitado  ? EstadoSubida.PENDIENTE : EstadoSubida.DESHABILITADO,
      logs:         [`[${new Date().toISOString()}] Backup iniciado`],
    });
    await this.repo.save(backup);

    this.ejecutarBackup(backup, cfg).catch((err) =>
      this.logger.error(`Backup ${backup.id} error inesperado: ${err.message}`),
    );

    return backup;
  }

  // ─── Ejecución interna ────────────────────────────────────────

  private async ejecutarBackup(backup: Backup, cfg: BackupConfig): Promise<void> {
    const logs:      string[] = [...backup.logs];
    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupDir  = cfg.directorioLocal;
    const tmpDir     = `/tmp/bk_${backup.id.replace(/-/g, '')}`;
    const outFile    = path.join(backupDir, `backup_${timestamp}.tar.gz`);

    const addLog = async (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      logs.push(line);
      await this.repo.update(backup.id, { logs: [...logs] });
    };

    try {
      await execAsync(`mkdir -p "${backupDir}" "${tmpDir}"`);

      // ── Base de datos ───────────────────────────────────────
      if (cfg.contenido.includes('db')) {
        await addLog('Generando dump de base de datos...');
        const host = this.config.get<string>('database.host') || 'localhost';
        const port = this.config.get<number>('database.port') || 5432;
        const db   = this.config.get<string>('database.database');
        const user = this.config.get<string>('database.username');
        const pass = (this.config.get<string>('database.password') || '').replace(/"/g, '\\"');

        await execAsync(
          `PGPASSWORD="${pass}" pg_dump -h ${host} -p ${port} -U ${user} ${db} | gzip -9 > "${tmpDir}/database.sql.gz"`,
        );
        await addLog('Dump de base de datos completado.');
      }

      // ── Configuraciones ─────────────────────────────────────
      if (cfg.contenido.includes('config')) {
        await addLog('Respaldando configuraciones...');
        const candidatos = [
          `${this.appDir}/backend/.env`,
          `${this.appDir}/backend/.env.production`,
          `${this.appDir}/frontend/.env`,
          `${this.appDir}/frontend/.env.production`,
          `${this.appDir}/ecosystem.config.js`,
        ].filter(f => fs.existsSync(f));

        if (candidatos.length) {
          const lista = candidatos.map(f => `"${f}"`).join(' ');
          await execAsync(`tar -czf "${tmpDir}/config.tar.gz" ${lista} 2>/dev/null || true`);
        }
        await addLog(`Configuraciones respaldadas (${candidatos.length} archivos).`);
      }

      // ── Uploads ─────────────────────────────────────────────
      if (cfg.contenido.includes('uploads')) {
        await addLog('Respaldando archivos subidos...');
        const uploadsDir = `${this.appDir}/backend/uploads`;
        if (fs.existsSync(uploadsDir)) {
          await execAsync(`tar -czf "${tmpDir}/uploads.tar.gz" "${uploadsDir}" 2>/dev/null || true`);
          await addLog('Uploads respaldados.');
        } else {
          await addLog('Directorio uploads no encontrado, omitiendo.');
        }
      }

      // ── MikroTik exports ────────────────────────────────────
      if (cfg.contenido.includes('mikrotik')) {
        await addLog('Respaldando configuraciones MikroTik...');
        const mkDir = `${this.appDir}/mikrotik-exports`;
        if (fs.existsSync(mkDir)) {
          await execAsync(`tar -czf "${tmpDir}/mikrotik.tar.gz" "${mkDir}" 2>/dev/null || true`);
          await addLog('Configs MikroTik respaldadas.');
        } else {
          await addLog('Directorio MikroTik no encontrado, omitiendo.');
        }
      }

      // ── Empaquetar final ────────────────────────────────────
      await addLog('Generando paquete final...');
      await execAsync(`tar -czf "${outFile}" -C "${tmpDir}" . 2>/dev/null`);

      const stat        = fs.statSync(outFile);
      const tamanoBytes = stat.size;

      backup.estado       = EstadoBackup.COMPLETADO;
      backup.archivoLocal = outFile;
      backup.tamanoBytes  = tamanoBytes;
      backup.completadoEn = new Date();
      backup.logs         = [...logs, `[${new Date().toISOString()}] Completado — ${(tamanoBytes / 1024 / 1024).toFixed(2)} MB`];
      await this.repo.save(backup);

      // ── Google Drive ────────────────────────────────────────
      if (cfg.drive.habilitado && cfg.drive.credencialesJson && cfg.drive.carpetaId) {
        await this.subirDrive(backup, cfg, outFile, addLog);
      }

      // ── Retención ───────────────────────────────────────────
      await this.aplicarRetencion(backup.empresaId, cfg.retencion);
      await addLog('Retención aplicada. Backup finalizado con éxito.');

    } catch (err: any) {
      const msg = err?.message || 'Error desconocido';
      logs.push(`[${new Date().toISOString()}] ERROR: ${msg}`);
      await this.repo.update(backup.id, {
        estado:       EstadoBackup.ERROR,
        errorMensaje: msg,
        completadoEn: new Date(),
        logs:         [...logs],
      });
      this.logger.error(`Backup ${backup.id} falló: ${msg}`);
    } finally {
      await execAsync(`rm -rf "${tmpDir}"`).catch(() => {});
    }
  }

  // ─── Google Drive (sin googleapis, solo axios + crypto) ───────

  private async getGoogleToken(credentialsJson: string): Promise<string> {
    const creds = JSON.parse(credentialsJson);
    const now   = Math.floor(Date.now() / 1000);

    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss:   creds.client_email,
      scope: 'https://www.googleapis.com/auth/drive.file',
      aud:   'https://oauth2.googleapis.com/token',
      exp:   now + 3600,
      iat:   now,
    })).toString('base64url');

    const signingInput = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(creds.private_key, 'base64url');

    const jwt = `${signingInput}.${signature}`;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;

    const res = await axios.post<{ access_token: string }>(
      'https://oauth2.googleapis.com/token',
      body,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return res.data.access_token;
  }

  private async subirDrive(
    backup: Backup,
    cfg: BackupConfig,
    filePath: string,
    addLog: (msg: string) => Promise<void>,
  ): Promise<void> {
    await addLog('Subiendo a Google Drive...');
    try {
      const token    = await this.getGoogleToken(cfg.drive.credencialesJson);
      const fileName = path.basename(filePath);
      const stat     = fs.statSync(filePath);

      // Initiate resumable upload session
      const initRes = await axios.post<void>(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
        JSON.stringify({ name: fileName, parents: [cfg.drive.carpetaId] }),
        {
          headers: {
            Authorization:            `Bearer ${token}`,
            'Content-Type':           'application/json',
            'X-Upload-Content-Type':  'application/gzip',
            'X-Upload-Content-Length': stat.size,
          },
        },
      );

      const uploadUrl = (initRes.headers as Record<string, string>).location;

      // Upload file stream
      const uploadRes = await axios.put<{ id: string; webViewLink: string }>(
        uploadUrl,
        fs.createReadStream(filePath),
        {
          headers: {
            'Content-Type':   'application/gzip',
            'Content-Length': stat.size,
          },
          params:         { fields: 'id,webViewLink' },
          maxBodyLength:  Infinity,
          maxContentLength: Infinity,
        },
      );

      await this.repo.update(backup.id, {
        driveFileId: uploadRes.data.id,
        driveUrl:    uploadRes.data.webViewLink,
        driveEstado: EstadoSubida.SUBIDO,
      });
      await addLog(`Subido a Google Drive correctamente (id: ${uploadRes.data.id}).`);
    } catch (err: any) {
      await this.repo.update(backup.id, { driveEstado: EstadoSubida.ERROR });
      await addLog(`Error al subir a Drive: ${err.message}`);
    }
  }

  // ─── Retención ────────────────────────────────────────────────

  private async aplicarRetencion(empresaId: string, maxBackups: number): Promise<void> {
    const todos = await this.repo.find({
      where: { empresaId, estado: EstadoBackup.COMPLETADO },
      order: { createdAt: 'ASC' },
    });

    if (todos.length <= maxBackups) return;

    const aEliminar = todos.slice(0, todos.length - maxBackups);
    for (const b of aEliminar) {
      if (b.archivoLocal && fs.existsSync(b.archivoLocal)) {
        try { fs.unlinkSync(b.archivoLocal); } catch {}
      }
      await this.repo.delete(b.id);
    }
    this.logger.log(`Retención: ${aEliminar.length} backups eliminados`);
  }

  // ─── Cron automático (cada minuto, lock diario por empresa) ───

  async cronBackupDiario(): Promise<void> {
    const empresas: { id: string }[] = await this.ds
      .query(`SELECT id FROM empresas WHERE deleted_at IS NULL`)
      .catch(() => []);

    for (const emp of empresas) {
      try {
        const cfg = await this.getConfig(emp.id);
        if (!cfg.habilitado) continue;

        const [hora, min] = cfg.horario.split(':').map(Number);
        const now = new Date();
        if (now.getHours() !== hora || now.getMinutes() !== min) continue;

        const lockKey = `cron:ran:backup:${emp.id}:${now.toISOString().split('T')[0]}`;
        if (await this.cache.get(lockKey)) continue;
        await this.cache.set(lockKey, '1', 23 * 60 * 60 * 1000);

        this.logger.log(`[CRON] Backup automático — empresa ${emp.id}`);
        await this.crearBackup(emp.id, TipoBackup.AUTO, 'sistema');
      } catch (err: any) {
        this.logger.error(`Cron backup empresa ${emp.id}: ${err.message}`);
      }
    }
  }
}
