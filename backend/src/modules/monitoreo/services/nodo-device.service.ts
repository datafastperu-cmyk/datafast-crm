import { Injectable, Logger } from '@nestjs/common';
import {
  RouterConnectionPool,
  RouterCredentials,
} from '../../mikrotik/services/connection-pool.service';
import { SnmpService }  from './snmp.service';
import { PingService }  from './ping.service';
import type { Nodo }    from '../entities/monitoreo.entity';

export interface TestConexionResult {
  conectado:   boolean;
  metodo:      string;
  latenciaMs?: number;
  info?:       Record<string, unknown>;
  error?:      string;
}

export interface MedicionApiResult {
  cpuPct?:        number;
  memoriaPct?:    number;
  temperatura?:   number;
  sesionesPppoe?: number;
}

// ─────────────────────────────────────────────────────────────
// NodoDeviceService
// Conecta equipos de red según fabricante/método:
//   MikroTik → RouterOS API (node-routeros)
//   Otros    → SNMP (ya existente) o Ping como fallback
// ─────────────────────────────────────────────────────────────
@Injectable()
export class NodoDeviceService {
  private readonly logger = new Logger(NodoDeviceService.name);

  constructor(
    private readonly pool:    RouterConnectionPool,
    private readonly snmpSvc: SnmpService,
    private readonly pingSvc: PingService,
  ) {}

  // ── Test con nodo ya registrado ────────────────────────────
  async testConexion(nodo: Nodo): Promise<TestConexionResult> {
    if (nodo.metodoConexion === 'api' && nodo.usuario && nodo.passwordCifrado) {
      return this.testMikrotikApi(this.buildCreds(nodo));
    }
    if (nodo.snmpHabilitado) {
      return this.testSnmp(nodo.ipMonitoreo, nodo.snmpCommunity, nodo.snmpVersion);
    }
    return this.testPingIp(nodo.ipMonitoreo);
  }

  // ── Test sin nodo registrado (desde el formulario) ─────────
  async testConexionRaw(params: {
    ip:         string;
    usuario:    string;
    password:   string;
    fabricante: string;
    puertoApi:  number;
    usarSsl:    boolean;
  }): Promise<TestConexionResult> {
    if (params.fabricante === 'MikroTik') {
      // connectDirect acepta password en texto plano (decrypt no lo modifica si no tiene ':')
      const tempCreds: RouterCredentials = {
        id:              `test-${Date.now()}`,
        ip:              params.ip,
        port:            params.puertoApi || 8728,
        user:            params.usuario,
        passwordCifrado: params.password,
        useSsl:          params.usarSsl || false,
        timeoutSec:      10,
        version:         'v7',
      };
      return this.testMikrotikApi(tempCreds, true);
    }
    return this.testPingIp(params.ip);
  }

  // ── Métricas completas via RouterOS API (para el worker) ───
  async getMedicionMikrotik(nodo: Nodo): Promise<MedicionApiResult | null> {
    if (!nodo.usuario || !nodo.passwordCifrado) return null;
    try {
      const creds = this.buildCreds(nodo);
      return await this.pool.execute(creds, async (api) => {
        const [[resource], active] = await Promise.all([
          api.write('/system/resource/print'),
          api.write('/ppp/active/print').catch(() => [] as any[]),
        ]);

        const totalMem = parseInt(resource?.['total-memory'] || '0', 10);
        const freeMem  = parseInt(resource?.['free-memory']  || '0', 10);

        return {
          cpuPct:        parseInt(resource?.['cpu-load'] || '0', 10),
          memoriaPct:    totalMem > 0 ? Math.round((1 - freeMem / totalMem) * 100) : undefined,
          temperatura:   resource?.['temperature'] ? parseFloat(resource['temperature']) : undefined,
          sesionesPppoe: Array.isArray(active) ? active.length : 0,
        };
      });
    } catch (err) {
      this.logger.warn(`getMedicionMikrotik ${nodo.nombre} (${nodo.ipMonitoreo}): ${err.message}`);
      return null;
    }
  }

  // ── Ejecutar script guardado en MikroTik ───────────────────
  async ejecutarScript(nodo: Nodo, scriptName: string): Promise<{ ok: boolean; error?: string }> {
    if (!nodo.usuario || !nodo.passwordCifrado) {
      return { ok: false, error: 'Nodo sin credenciales configuradas' };
    }
    try {
      const creds = this.buildCreds(nodo);
      await this.pool.execute(creds, (api) =>
        api.write('/system/script/run', [`=name=${scriptName}`]),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Internos ───────────────────────────────────────────────

  private async testMikrotikApi(
    creds: RouterCredentials,
    directo = false,
  ): Promise<TestConexionResult> {
    const t0 = Date.now();
    try {
      const connect = directo
        ? (fn: (api: any) => Promise<any>) => this.pool.connectDirect(creds).then(async (api) => {
            const r = await fn(api);
            try { await api.close(); } catch { /* */ }
            return r;
          })
        : (fn: (api: any) => Promise<any>) => this.pool.execute(creds, fn);

      const info = await connect(async (api: any) => {
        const [[identity], [resource]] = await Promise.all([
          api.write('/system/identity/print'),
          api.write('/system/resource/print'),
        ]);
        return {
          hostname: identity?.name,
          board:    resource?.['board-name'],
          version:  resource?.version,
          cpu:      (resource?.['cpu-load'] ?? '?') + '%',
          uptime:   resource?.uptime,
        };
      });

      return { conectado: true, metodo: 'api', latenciaMs: Date.now() - t0, info };
    } catch (err) {
      return { conectado: false, metodo: 'api', error: err.message };
    }
  }

  private async testSnmp(
    ip: string, community: string, version: number,
  ): Promise<TestConexionResult> {
    const t0 = Date.now();
    try {
      const conectado = await this.snmpSvc.testConnection(ip, community, version);
      return { conectado, metodo: 'snmp', latenciaMs: Date.now() - t0 };
    } catch (err) {
      return { conectado: false, metodo: 'snmp', error: err.message };
    }
  }

  private async testPingIp(ip: string): Promise<TestConexionResult> {
    const t0 = Date.now();
    try {
      const result = await this.pingSvc.ping(ip, 3, 3000);
      return {
        conectado:  result.alive,
        metodo:     'ping',
        latenciaMs: result.avg ?? (Date.now() - t0),
      };
    } catch (err) {
      return { conectado: false, metodo: 'ping', error: err.message };
    }
  }

  private buildCreds(nodo: Nodo): RouterCredentials {
    return {
      id:              nodo.id,
      ip:              nodo.ipMonitoreo,
      port:            nodo.puertoApi   ?? 8728,
      user:            nodo.usuario,
      passwordCifrado: nodo.passwordCifrado,
      useSsl:          nodo.usarSsl     ?? false,
      timeoutSec:      10,
      version:         'v7',
    };
  }
}
