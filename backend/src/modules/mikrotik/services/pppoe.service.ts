import { Injectable, Logger } from '@nestjs/common';
import { RouterOSAPI } from 'node-routeros';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';
import { decrypt, encrypt } from '../../../common/utils/encryption.util';

export interface PppoeUser {
  id?:          string;  // RouterOS .id
  name:         string;
  password:     string;
  profile:      string;
  service:      string;  // 'pppoe' | 'pptp' | 'any'
  remoteAddress?: string; // IP asignada
  comment?:     string;
  disabled:     boolean;
  callerID?:    string;
  lastLoggedOut?: string;
}

export interface PppoeSecret {
  '.id':          string;
  name:           string;
  password:       string;
  profile:        string;
  service:        string;
  'remote-address'?: string;
  comment?:       string;
  disabled:       string; // 'true' | 'false'
  'last-logged-out'?: string;
  'caller-id'?:   string;
}

export interface PppoeSession {
  '.id':        string;
  name:         string;
  service:      string;
  'caller-id':  string;
  address:      string;
  uptime:       string;
  encoding:     string;
  'session-id': string;
  comment?:     string;
  'rx-bytes':   string;
  'tx-bytes':   string;
  mtu:          string;
}

export interface CreatePppoeParams {
  name:           string;
  password:       string;
  profile:        string;
  service?:       string;
  remoteAddress?: string;
  comment?:       string;
  disabled?:      boolean;
}

@Injectable()
export class PppoeService {
  private readonly logger = new Logger(PppoeService.name);

  constructor(private readonly pool: RouterConnectionPool) {}

  // ── Crear usuario PPPoE ────────────────────────────────────
  async crear(creds: RouterCredentials, params: CreatePppoeParams): Promise<string> {
    return this.pool.execute(creds, async (api) => {
      // Verificar si ya existe
      const existing = await api.write('/ppp/secret/print', [
        `?name=${params.name}`,
      ]);

      if (existing.length > 0) {
        this.logger.warn(`PPPoE: usuario ${params.name} ya existe en ${creds.ip} — actualizando`);
        const existingId = existing[0]['.id'];
        await api.write('/ppp/secret/set', [
          `=.id=${existingId}`,
          `=password=${params.password}`,
          `=profile=${params.profile}`,
          `=service=${params.service || 'pppoe'}`,
          ...(params.remoteAddress ? [`=remote-address=${params.remoteAddress}`] : []),
          ...(params.comment ? [`=comment=${params.comment}`] : []),
          `=disabled=${params.disabled ? 'yes' : 'no'}`,
        ]);
        return existingId;
      }

      // Crear nuevo
      const result = await api.write('/ppp/secret/add', [
        `=name=${params.name}`,
        `=password=${params.password}`,
        `=profile=${params.profile}`,
        `=service=${params.service || 'pppoe'}`,
        ...(params.remoteAddress ? [`=remote-address=${params.remoteAddress}`] : []),
        ...(params.comment ? [`=comment=${params.comment}`] : []),
        `=disabled=${params.disabled ? 'yes' : 'no'}`,
      ]);

      const id = result?.[0]?.ret || '';
      this.logger.log(`PPPoE creado: ${params.name} en ${creds.ip}`);
      return id;
    });
  }

  // ── Eliminar usuario PPPoE ─────────────────────────────────
  async eliminar(creds: RouterCredentials, name: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
      if (secrets.length === 0) {
        this.logger.warn(`PPPoE: usuario ${name} no existe en ${creds.ip}`);
        return;
      }
      await api.write('/ppp/secret/remove', [`=.id=${secrets[0]['.id']}`]);
      this.logger.log(`PPPoE eliminado: ${name} en ${creds.ip}`);
    });
  }

  // ── Habilitar / Deshabilitar usuario ───────────────────────
  async setEstado(creds: RouterCredentials, name: string, disabled: boolean): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
      if (secrets.length === 0) return;

      await api.write('/ppp/secret/set', [
        `=.id=${secrets[0]['.id']}`,
        `=disabled=${disabled ? 'yes' : 'no'}`,
      ]);
      this.logger.log(`PPPoE ${disabled ? 'deshabilitado' : 'habilitado'}: ${name} en ${creds.ip}`);
    });
  }

  // ── Desconectar sesión activa ──────────────────────────────
  async desconectarSesion(creds: RouterCredentials, name: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const sessions = await api.write('/ppp/active/print', [`?name=${name}`]);
      for (const session of sessions) {
        await api.write('/ppp/active/remove', [`=.id=${session['.id']}`]);
        this.logger.log(`Sesión PPPoE desconectada: ${name} en ${creds.ip}`);
      }
    });
  }

  // ── Cambiar contraseña ─────────────────────────────────────
  async cambiarPassword(creds: RouterCredentials, name: string, newPassword: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
      if (secrets.length === 0) return;

      await api.write('/ppp/secret/set', [
        `=.id=${secrets[0]['.id']}`,
        `=password=${newPassword}`,
      ]);

      // Desconectar sesión activa para forzar re-autenticación
      await this.desconectarSesion(creds, name);
    });
  }

  // ── Obtener secretos (usuarios PPPoE) ─────────────────────
  async listarSecrets(creds: RouterCredentials, filter?: string): Promise<PppoeSecret[]> {
    return this.pool.execute(creds, async (api) => {
      const args = filter ? [`?name=${filter}`] : [];
      return api.write('/ppp/secret/print', args);
    });
  }

  // ── Obtener sesiones activas ────────────────────────────────
  async listarSesionesActivas(creds: RouterCredentials): Promise<PppoeSession[]> {
    return this.pool.execute(creds, async (api) => {
      return api.write('/ppp/active/print');
    });
  }

  // ── Sesión de un usuario específico ────────────────────────
  async getSesion(creds: RouterCredentials, name: string): Promise<PppoeSession | null> {
    const sessions = await this.pool.execute(creds, (api) =>
      api.write('/ppp/active/print', [`?name=${name}`]),
    );
    return sessions[0] || null;
  }

  // ── Listar perfiles PPPoE ─────────────────────────────────
  async listarPerfiles(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, (api) =>
      api.write('/ppp/profile/print'),
    );
  }

  // ── Crear perfil PPPoE si no existe ───────────────────────
  async crearPerfilSiNoExiste(
    creds:   RouterCredentials,
    nombre:  string,
    params:  { rateLimit?: string; sessionTimeout?: string },
  ): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const existing = await api.write('/ppp/profile/print', [`?name=${nombre}`]);
      if (existing.length > 0) return;

      await api.write('/ppp/profile/add', [
        `=name=${nombre}`,
        ...(params.rateLimit ? [`=rate-limit=${params.rateLimit}`] : []),
        ...(params.sessionTimeout ? [`=session-timeout=${params.sessionTimeout}`] : []),
        `=use-compression=no`,
        `=use-encryption=no`,
      ]);
      this.logger.log(`Perfil PPPoE creado: ${nombre} en ${creds.ip}`);
    });
  }

  // ── Estadísticas de tráfico de la sesión ──────────────────
  async getTraficoSesion(creds: RouterCredentials, name: string): Promise<{
    rxBytes: number; txBytes: number; uptime: string;
  } | null> {
    const session = await this.getSesion(creds, name);
    if (!session) return null;
    return {
      rxBytes: parseInt(session['rx-bytes'] || '0', 10),
      txBytes: parseInt(session['tx-bytes'] || '0', 10),
      uptime:  session.uptime || '0s',
    };
  }
}
