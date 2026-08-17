import { Injectable, Logger } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials, PoolChannel, clasificarErrorMikrotik } from './connection-pool.service';
import { ResultadoOperacion } from '../../../common/domain/resultado-operacion';

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

  // Ola 1, grupo 3b, bloque grande (2026-08-17). Las 4 consumidas por ContratosService
  // (síncrono en cambiarEstado() — B-4, registrado y no resuelto aquí),
  // OutboxRedService.ejecutarComando(), PromesasPagoService y CobranzaWorker.
  //
  // ── Crear usuario PPPoE ────────────────────────────────────
  // Ninguna condición de rechazado_definitivo: upsert puro, sin gate de datos.
  async crear(creds: RouterCredentials, params: CreatePppoeParams): Promise<ResultadoOperacion> {
    try {
      await this.pool.execute(creds, async (api) => { // @ts-ignore
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
      return { clase: 'aplicado', mensaje: `Secret PPPoE ${params.name} creado.` };
    } catch (err) {
      return clasificarErrorMikrotik(err);
    }
  }

  // ── Eliminar usuario PPPoE ─────────────────────────────────
  // "No existe" es `ya_en_destino`, no `no_aplica`: la operación SÍ aplica a este sujeto
  // (un secret PPPoE de este contrato) — es que el estado destino ("sin secret") ya estaba
  // alcanzado. `no_aplica` sería si la operación no tuviera sentido para el sujeto (p.ej. un
  // contrato sin PPPoE); aquí el sujeto es el correcto y ya llegó a donde se le pedía llegar.
  async eliminar(creds: RouterCredentials, name: string): Promise<ResultadoOperacion> {
    try {
      const existia = await this.pool.execute(creds, async (api) => {
        const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
        if (secrets.length === 0) {
          this.logger.warn(`PPPoE: usuario ${name} no existe en ${creds.ip}`);
          return false;
        }
        await api.write('/ppp/secret/remove', [`=.id=${secrets[0]['.id']}`]);
        this.logger.log(`PPPoE eliminado: ${name} en ${creds.ip}`);
        return true;
      });
      if (!existia) return { clase: 'ya_en_destino', mensaje: `El secret PPPoE ${name} ya no existía.` };
      return { clase: 'aplicado', mensaje: `Secret PPPoE ${name} eliminado.` };
    } catch (err) {
      return clasificarErrorMikrotik(err);
    }
  }

  // ── Habilitar / Deshabilitar usuario ───────────────────────
  // Mismo criterio que eliminar(): "no existe" es ya_en_destino (nada que deshabilitar es
  // el mismo destino que un secret ya deshabilitado, desde la perspectiva del contrato).
  async setEstado(creds: RouterCredentials, name: string, disabled: boolean): Promise<ResultadoOperacion> {
    try {
      const existia = await this.pool.execute(creds, async (api) => {
        const secrets = await api.write('/ppp/secret/print', [`?name=${name}`]);
        if (secrets.length === 0) return false;

        await api.write('/ppp/secret/set', [
          `=.id=${secrets[0]['.id']}`,
          `=disabled=${disabled ? 'yes' : 'no'}`,
        ]);
        this.logger.log(`PPPoE ${disabled ? 'deshabilitado' : 'habilitado'}: ${name} en ${creds.ip}`);
        return true;
      });
      if (!existia) return { clase: 'ya_en_destino', mensaje: `El secret PPPoE ${name} no existe.` };
      return { clase: 'aplicado', mensaje: `Secret PPPoE ${name} ${disabled ? 'deshabilitado' : 'habilitado'}.` };
    } catch (err) {
      return clasificarErrorMikrotik(err);
    }
  }

  // ── Desconectar sesión activa ──────────────────────────────
  // Cero sesiones activas es el mismo caso: el destino ("sin sesión activa") ya estaba
  // alcanzado, no es que desconectar no aplique a este secret.
  async desconectarSesion(creds: RouterCredentials, name: string): Promise<ResultadoOperacion> {
    try {
      const removidas = await this.pool.execute(creds, async (api) => {
        const sessions = await api.write('/ppp/active/print', [`?name=${name}`]);
        for (const session of sessions) {
          await api.write('/ppp/active/remove', [`=.id=${session['.id']}`]);
          this.logger.log(`Sesión PPPoE desconectada: ${name} en ${creds.ip}`);
        }
        return sessions.length;
      });
      if (removidas === 0) return { clase: 'ya_en_destino', mensaje: `No había sesión PPPoE activa para ${name}.` };
      return { clase: 'aplicado', mensaje: `${removidas} sesión(es) PPPoE desconectada(s) para ${name}.` };
    } catch (err) {
      return clasificarErrorMikrotik(err);
    }
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
  async listarSecrets(creds: RouterCredentials, filter?: string): Promise<any[]> {
    return this.pool.execute(creds, async (api) => { // @ts-ignore
      const args = filter ? [`?name=${filter}`] : [];
      return api.write('/ppp/secret/print', args);
    });
  }

  // ── Obtener sesiones activas ────────────────────────────────
  async listarSesionesActivas(creds: RouterCredentials): Promise<any[]> {
    return this.pool.execute(creds, async (api) => { // @ts-ignore
      return api.write('/ppp/active/print');
    });
  }

  // ── Contar sesiones activas (count-only) ────────────────────
  async contarSesionesActivas(creds: RouterCredentials, channel: PoolChannel = 'provision'): Promise<number> {
    return this.pool.execute(creds, async (api) => {
      const result = await api.write('/ppp/active/print', ['=count-only=']);
      const n = parseInt(result?.[0]?.ret ?? '0', 10);
      return isNaN(n) ? 0 : n;
    }, 2, channel);
  }

  // ── Sesión de un usuario específico ────────────────────────
  async getSesion(creds: RouterCredentials, name: string): Promise<any | null> {
    const sessions = await this.pool.execute(creds, (api) =>
      api.write('/ppp/active/print', [`?name=${name}`]),
    );
    return (sessions[0] || null) as any;
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
