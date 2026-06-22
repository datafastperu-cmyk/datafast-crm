import { Injectable, Logger } from '@nestjs/common';
import { HttpService }        from '@nestjs/axios';
import { firstValueFrom }     from 'rxjs';
import { AxiosRequestConfig } from 'axios';

import { OltDispositivo }    from '../entities/olt-dispositivo.entity';
import { TipoProveedor }     from '../entities/olt-proveedor-config.entity';
import {
  IOltProvider,
  OltDeprovisionDatos,
  OltDeprovisionPayload,
  OltMetricasDatos,
  OltMetricasPayload,
  OltOnuEncontrada,
  OltOperacionResult,
  OltProvisionDatos,
  OltProvisionPayload,
  ProveedorCredenciales,
} from '../interfaces/olt-provider.interface';

// ─────────────────────────────────────────────────────────────
// AdminOltProvider
//
// Adaptador HTTP para la API REST de AdminOLT.
// Usa credenciales (baseUrl, apiKey, oltIdExterno) por OLT,
// almacenadas en olt_proveedor_config.credenciales.
//
// Endpoints AdminOLT utilizados:
//   GET  /api/v1/olts/{id}                        — testConexion
//   GET  /api/v1/olts/{id}/onus/unprovisioned     — descubrirOnus
//   GET  /api/v1/onus/search?serial=X             — buscar ONU
//   GET  /api/v1/onus/{serial}/metrics            — métricas ópticas
//   POST /api/v1/onus/provision                   — provisionar
//   DEL  /api/v1/onus/{serial}                    — desaprovisionar
//
// NOTA: Los endpoints exactos dependen de la versión de AdminOLT
// instalada. Ajustar baseUrl en olt_proveedor_config si el prefijo
// difiere (ej. /api/v2/...).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class AdminOltProvider implements IOltProvider {
  readonly tipo: TipoProveedor = 'adminolt';

  private readonly logger = new Logger(AdminOltProvider.name);

  constructor(private readonly http: HttpService) {}

  // ── HTTP helpers ─────────────────────────────────────────────

  private cfg(creds: ProveedorCredenciales): AxiosRequestConfig {
    return {
      baseURL: (creds.baseUrl ?? '').replace(/\/$/, ''),
      timeout: 30_000,
      headers: {
        'X-API-Key':    creds.apiKey ?? '',
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
    };
  }

  private async get<T>(creds: ProveedorCredenciales, path: string, params?: Record<string, string>): Promise<T> {
    const cfg = this.cfg(creds);
    if (params) cfg.params = params;
    const res = await firstValueFrom(this.http.get<T>(path, cfg));
    return res.data;
  }

  private async post<T>(creds: ProveedorCredenciales, path: string, body: unknown): Promise<T> {
    const res = await firstValueFrom(this.http.post<T>(path, body, this.cfg(creds)));
    return res.data;
  }

  private async delete(creds: ProveedorCredenciales, path: string): Promise<void> {
    await firstValueFrom(this.http.delete(path, this.cfg(creds)));
  }

  // ── pon_port parser ──────────────────────────────────────────
  // AdminOLT usa formato "slot/port" o "frame/slot/port"
  private parsePonPort(ponPort: string): { slot: number; port: number } {
    const parts = (ponPort ?? '').split('/');
    if (parts.length >= 3) {
      return { slot: parseInt(parts[1], 10), port: parseInt(parts[2], 10) };
    }
    if (parts.length === 2) {
      return { slot: parseInt(parts[0], 10), port: parseInt(parts[1], 10) };
    }
    return { slot: 0, port: 0 };
  }

  // ────────────────────────────────────────────────────────────
  // testConexion — GET a la OLT en AdminOLT
  // ────────────────────────────────────────────────────────────
  async testConexion(
    _olt:  OltDispositivo,
    creds: ProveedorCredenciales,
  ): Promise<OltOperacionResult> {
    const t0    = Date.now();
    const oltId = creds.oltIdExterno ?? '';

    if (!oltId) {
      return { exitoso: false, mensaje: 'oltIdExterno no configurado en credenciales AdminOLT', latenciaMs: 0, proveedor: this.tipo };
    }
    if (!creds.baseUrl) {
      return { exitoso: false, mensaje: 'baseUrl no configurada en credenciales AdminOLT', latenciaMs: 0, proveedor: this.tipo };
    }

    try {
      const olt = await this.get<any>(creds, `/api/v1/olts/${oltId}`);
      return {
        exitoso: true,
        mensaje: `AdminOLT conectado — OLT: ${olt?.name ?? oltId} (${olt?.status ?? 'desconocido'})`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      const status  = err?.response?.status;
      const mensaje = status === 401 || status === 403
        ? 'API Key inválida o sin permisos'
        : status === 404
          ? `OLT ID "${oltId}" no encontrada en AdminOLT`
          : err?.message ?? 'Error de conexión con AdminOLT';

      return { exitoso: false, mensaje, latenciaMs: Date.now() - t0, proveedor: this.tipo };
    }
  }

  // ────────────────────────────────────────────────────────────
  // provisionar
  // ────────────────────────────────────────────────────────────
  async provisionar(
    olt:     OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltProvisionPayload,
  ): Promise<OltOperacionResult<OltProvisionDatos>> {
    const t0 = Date.now();
    try {
      const body = {
        serial:      payload.sn.toUpperCase(),
        olt_id:      creds.oltIdExterno ?? '',
        pon_port:    `0/${payload.slot}/${payload.port}`,
        profile:     payload.profileSpeed,
        vlan:        payload.vlan,
        description: olt.nombre,
      };

      const result = await this.post<any>(creds, '/api/v1/onus/provision', body);

      const onuId = result?.id ?? result?.onu_id ?? result?.serial;

      if (!onuId) {
        return { exitoso: false, mensaje: 'AdminOLT no retornó identificador de ONU válido', latenciaMs: Date.now() - t0, proveedor: this.tipo };
      }

      return {
        exitoso: true,
        datos:   { oltIp: olt.ipGestion, onuSn: payload.sn, details: { adminolt_id: onuId } },
        mensaje: `ONU aprovisionada en AdminOLT — ID: ${onuId}`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      this.logger.error(`provisionar | OLT=${olt.nombre} SN=${payload.sn}: ${err?.message}`);
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Error al provisionar en AdminOLT';
      return { exitoso: false, mensaje: msg, latenciaMs: Date.now() - t0, proveedor: this.tipo };
    }
  }

  // ────────────────────────────────────────────────────────────
  // desaprovisionar
  // ────────────────────────────────────────────────────────────
  async desaprovisionar(
    olt:     OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltDeprovisionPayload,
  ): Promise<OltOperacionResult<OltDeprovisionDatos>> {
    const t0 = Date.now();
    try {
      await this.delete(creds, `/api/v1/onus/${payload.sn.toUpperCase()}`);

      return {
        exitoso: true,
        datos:   { oltIp: olt.ipGestion, onuId: payload.onuId, details: null },
        mensaje: `ONU ${payload.sn} eliminada de AdminOLT`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      const status = err?.response?.status;

      // 404 = ya no existe en AdminOLT → idempotente
      if (status === 404) {
        this.logger.warn(`desaprovisionar | SN=${payload.sn} no encontrada en AdminOLT — omitiendo`);
        return {
          exitoso: true,
          datos:   { oltIp: olt.ipGestion, onuId: payload.onuId, details: { skipped: true } },
          mensaje: `ONU ${payload.sn} no encontrada en AdminOLT (ya eliminada)`,
          latenciaMs: Date.now() - t0,
          proveedor: this.tipo,
        };
      }

      this.logger.error(`desaprovisionar | OLT=${olt.nombre} SN=${payload.sn}: ${err?.message}`);
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al desaprovisionar en AdminOLT';
      return { exitoso: false, mensaje: msg, latenciaMs: Date.now() - t0, proveedor: this.tipo };
    }
  }

  // ────────────────────────────────────────────────────────────
  // descubrirOnus
  // ────────────────────────────────────────────────────────────
  async descubrirOnus(
    _olt:  OltDispositivo,
    creds: ProveedorCredenciales,
    slot?: number,
    port?: number,
  ): Promise<OltOperacionResult<OltOnuEncontrada[]>> {
    const t0    = Date.now();
    const oltId = creds.oltIdExterno ?? '';

    try {
      const raw = await this.get<any[]>(creds, `/api/v1/olts/${oltId}/onus/unprovisioned`);
      const todas = (raw ?? []).map((o) => {
        const { slot: s, port: p } = this.parsePonPort(o.pon_port ?? o.ponPort ?? '');
        return { sn: (o.serial ?? o.sn ?? '').toUpperCase(), slot: s, port: p } as OltOnuEncontrada;
      });

      const filtradas = (slot !== undefined || port !== undefined)
        ? todas.filter((o) =>
            (slot === undefined || o.slot === slot) &&
            (port === undefined || o.port === port),
          )
        : todas;

      return {
        exitoso: true,
        datos:   filtradas,
        mensaje: `${filtradas.length} ONU(s) no aprovisionadas vía AdminOLT`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al descubrir ONUs en AdminOLT';
      return { exitoso: false, mensaje: msg, latenciaMs: Date.now() - t0, proveedor: this.tipo };
    }
  }

  // ────────────────────────────────────────────────────────────
  // obtenerMetricas
  // ────────────────────────────────────────────────────────────
  async obtenerMetricas(
    _olt:    OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltMetricasPayload,
  ): Promise<OltOperacionResult<OltMetricasDatos>> {
    const t0  = Date.now();
    const sn  = payload.sn ?? '';

    if (!sn) {
      return {
        exitoso: true,
        datos:   { status: 'offline', metricsAvailable: false },
        mensaje: 'Serial requerido para consultar métricas en AdminOLT',
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    }

    try {
      const metrics = await this.get<any>(creds, `/api/v1/onus/${sn.toUpperCase()}/metrics`);

      const datos: OltMetricasDatos = {
        status:           metrics?.status === 'online' ? 'online' : 'offline',
        metricsAvailable: true,
        rxPowerDbm:       metrics?.rx_power    ?? metrics?.rxPower    ?? null,
        txPowerDbm:       metrics?.tx_power    ?? metrics?.txPower    ?? null,
        temperatureC:     metrics?.temperature ?? null,
        alarm:            null,
      };

      return { exitoso: true, datos, mensaje: 'OK', latenciaMs: Date.now() - t0, proveedor: this.tipo };

    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        return {
          exitoso: true,
          datos:   { status: 'offline', metricsAvailable: false },
          mensaje: `ONU ${sn} no encontrada en AdminOLT`,
          latenciaMs: Date.now() - t0,
          proveedor: this.tipo,
        };
      }
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al obtener métricas de AdminOLT';
      return {
        exitoso: false,
        datos:   { status: 'offline', metricsAvailable: false },
        mensaje: msg,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    }
  }
}
