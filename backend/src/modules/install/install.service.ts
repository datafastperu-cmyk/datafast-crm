import {
  Injectable, Logger, BadRequestException,
  ConflictException, ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';

const INSTALL_FLAG = path.join(process.env.INSTALL_DIR || '/opt/datafast', '.installed');
const APP_DIR = process.env.INSTALL_DIR || '/opt/datafast';

export interface DbConfigDto {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface ActivateLicenseDto {
  email: string;
  licenseKey: string;
}

@Injectable()
export class InstallService {
  private readonly logger = new Logger(InstallService.name);

  constructor(private readonly config: ConfigService) {}

  // ── Estado de instalación ────────────────────────────────────
  getStatus() {
    const consoleInstalled = fs.existsSync(path.join(APP_DIR, '.installed_console'));
    const webInstalled     = fs.existsSync(INSTALL_FLAG);
    const isDev            = (process.env.NODE_ENV || 'development') === 'development';

    return {
      consoleInstalled,
      webInstalled,
      canProceed: consoleInstalled && !webInstalled,
      isDev,
    };
  }

  // ── Bloquear si ya está instalado vía web ────────────────────
  assertNotInstalled() {
    if (fs.existsSync(INSTALL_FLAG)) {
      throw new ForbiddenException(
        'El sistema ya está instalado. Accede al panel de administración.',
      );
    }
  }

  // ── Leer configuración actual del .env ──────────────────────
  getCurrentDbConfig(): DbConfigDto {
    return {
      host:     this.config.get<string>('database.host')     || 'localhost',
      port:     this.config.get<number>('database.port')     || 5432,
      username: this.config.get<string>('database.username') || 'datafast_db_user',
      password: this.config.get<string>('database.password') || '',
      database: this.config.get<string>('database.database') || 'datafast_db',
    };
  }

  // ── Validar conexión a base de datos ─────────────────────────
  async testDbConnection(dto: DbConfigDto): Promise<{ ok: boolean; message: string; details?: string }> {
    const ds = new DataSource({
      type:     'postgres',
      host:     dto.host,
      port:     dto.port,
      username: dto.username,
      password: dto.password,
      database: dto.database,
      connectTimeoutMS: 8000,
    } as DataSourceOptions);

    try {
      await ds.initialize();
      const result = await ds.query('SELECT version(), current_database(), current_user, pg_has_role(current_user, $1, $2) AS tiene_permiso', [dto.username, 'MEMBER']);
      await ds.destroy();

      const row = result[0];
      return {
        ok: true,
        message: 'Conexión exitosa',
        details: `PostgreSQL ${row.version?.split(' ')[1] || ''} | BD: ${row.current_database} | Usuario: ${row.current_user}`,
      };
    } catch (err: any) {
      try { await ds.destroy(); } catch {}

      const msg = this.friendlyDbError(err.message || err.code || 'Error desconocido');
      return { ok: false, message: msg };
    }
  }

  // ── Activar licencia + ejecutar migraciones + crear admin ────
  async activateAndFinalize(dto: ActivateLicenseDto): Promise<{ adminEmail: string; adminPassword: string }> {
    this.assertNotInstalled();

    const isDev = (process.env.NODE_ENV || 'development') === 'development';

    if (!dto.email) {
      throw new BadRequestException('Email es requerido');
    }

    if (!isDev && !dto.licenseKey) {
      throw new BadRequestException('Código de licencia requerido');
    }

    // Validar formato básico del email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email)) {
      throw new BadRequestException('Email inválido');
    }

    // Guardar la licencia en el .env (solo en producción)
    if (!isDev && dto.licenseKey) {
      this.writeLicenseKey(dto.licenseKey.trim());
    }

    // Ejecutar migraciones
    await this.runMigrations();

    // Crear o actualizar el usuario administrador inicial
    await this.createAdminUser(dto.email);

    // Marcar el sistema como instalado (impide acceso futuro al installer)
    this.markInstalled(dto.email);

    this.logger.log(`Instalación web completada. Admin: ${dto.email}`);

    return { adminEmail: dto.email, adminPassword: 'Admin123' };
  }

  // ── Ejecutar migraciones vía CLI ─────────────────────────────
  private async runMigrations(): Promise<void> {
    const backendDir = path.join(APP_DIR, 'backend');

    if (!fs.existsSync(path.join(backendDir, 'dist'))) {
      this.logger.warn('Backend dist no encontrado — migraciones se ejecutarán en modo dev');
    }

    try {
      const envFile = path.join(backendDir, '.env.production');
      const envExists = fs.existsSync(envFile);
      const envFlag   = envExists ? `NODE_ENV=production` : '';

      execSync(
        `cd "${backendDir}" && ${envFlag} npm run migration:run 2>&1`,
        { timeout: 120_000, stdio: 'pipe' },
      );
      this.logger.log('Migraciones ejecutadas correctamente');
    } catch (err: any) {
      const output = err.stdout?.toString() || err.stderr?.toString() || '';
      // Si ya están aplicadas no es un error real
      if (output.includes('No migrations are pending')) {
        this.logger.log('Migraciones ya aplicadas — skip');
        return;
      }
      this.logger.error('Error ejecutando migraciones:', output.slice(-500));
      throw new BadRequestException('Error ejecutando migraciones de base de datos. Verifica la conexión y vuelve a intentar.');
    }
  }

  // ── Crear usuario admin/admin en la BD ──────────────────────
  private async createAdminUser(email: string): Promise<void> {
    const dbCfg = this.getCurrentDbConfig();
    const ds = new DataSource({
      type:     'postgres',
      host:     dbCfg.host,
      port:     dbCfg.port,
      username: dbCfg.username,
      password: dbCfg.password,
      database: dbCfg.database,
    } as DataSourceOptions);

    try {
      await ds.initialize();
      const passwordHash = await bcrypt.hash('Admin123', 12);

      // Actualizar o insertar el usuario admin
      await ds.query(`
        INSERT INTO usuarios (
          id, empresa_id, nombres, apellidos, email,
          password_hash, estado, email_verificado
        ) VALUES (
          'c0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000001',
          'Super', 'Administrador', $1,
          $2, 'activo', true
        )
        ON CONFLICT (id) DO UPDATE SET
          password_hash = $2,
          email = $1,
          estado = 'activo'
      `, [email, passwordHash]);

      // Asegurar que tiene rol Super Administrador
      await ds.query(`
        INSERT INTO usuarios_roles (usuario_id, rol_id)
        SELECT 'c0000000-0000-0000-0000-000000000001', id
        FROM roles
        WHERE nombre = 'Super Administrador' AND empresa_id = 'a0000000-0000-0000-0000-000000000001'
        ON CONFLICT DO NOTHING
      `);

      // También asignar rol Administrador como fallback
      await ds.query(`
        INSERT INTO usuarios_roles (usuario_id, rol_id)
        SELECT 'c0000000-0000-0000-0000-000000000001', id
        FROM roles
        WHERE nombre = 'Administrador' AND empresa_id = 'a0000000-0000-0000-0000-000000000001'
        ON CONFLICT DO NOTHING
      `);

      await ds.destroy();
    } catch (err: any) {
      try { await ds.destroy(); } catch {}
      throw new BadRequestException(`Error creando usuario administrador: ${err.message}`);
    }
  }

  // ── Escribir LICENSE_KEY al .env ────────────────────────────
  private writeLicenseKey(licenseKey: string): void {
    const envPath = path.join(APP_DIR, 'backend', '.env.production');

    if (!fs.existsSync(envPath)) {
      this.logger.warn('.env.production no encontrado — escribiendo LICENSE_KEY en variable de proceso');
      process.env.LICENSE_KEY = licenseKey;
      return;
    }

    let content = fs.readFileSync(envPath, 'utf8');

    if (content.includes('LICENSE_KEY=')) {
      content = content.replace(/^LICENSE_KEY=.*$/m, `LICENSE_KEY=${licenseKey}`);
    } else {
      content += `\nLICENSE_KEY=${licenseKey}\n`;
    }

    fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
    process.env.LICENSE_KEY = licenseKey;
    this.logger.log('LICENSE_KEY guardada en .env.production');
  }

  // ── Marcar instalación web como completa ─────────────────────
  private markInstalled(email: string): void {
    try {
      fs.mkdirSync(path.dirname(INSTALL_FLAG), { recursive: true });
      fs.writeFileSync(INSTALL_FLAG, JSON.stringify({
        installedAt: new Date().toISOString(),
        email,
        version: process.env.npm_package_version || '1.0.0',
      }), { encoding: 'utf8', mode: 0o600 });
    } catch (err: any) {
      this.logger.warn(`No se pudo escribir flag de instalación: ${err.message}`);
    }
  }

  // ── Mensajes de error legibles para el usuario ───────────────
  private friendlyDbError(raw: string): string {
    if (raw.includes('ECONNREFUSED') || raw.includes('connect ECONNREFUSED')) {
      return 'No se pudo conectar al servidor de base de datos. Verifica que PostgreSQL esté corriendo y que el host/puerto sean correctos.';
    }
    if (raw.includes('password authentication') || raw.includes('28P01')) {
      return 'Credenciales incorrectas. Verifica el usuario y la contraseña.';
    }
    if (raw.includes('does not exist') || raw.includes('3D000')) {
      return 'La base de datos no existe. Créala primero o verifica el nombre.';
    }
    if (raw.includes('role') && raw.includes('does not exist')) {
      return 'El usuario de base de datos no existe. Créalo primero con los permisos necesarios.';
    }
    if (raw.includes('ETIMEDOUT') || raw.includes('timeout')) {
      return 'Tiempo de espera agotado. El servidor de base de datos no responde a tiempo.';
    }
    if (raw.includes('permission denied') || raw.includes('42501')) {
      return 'Permisos insuficientes. El usuario de BD no tiene acceso a la base de datos.';
    }
    return `Error de conexión: ${raw.substring(0, 150)}`;
  }
}
