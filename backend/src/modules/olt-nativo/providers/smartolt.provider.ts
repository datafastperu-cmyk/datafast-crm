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
// SmartoltProvider
//
// Adaptador HTTP para la API REST de SmartOLT.
// Usa credenciales (baseUrl, apiKey, oltIdExterno) almacenadas
// por OLT en olt_proveedor_config.credenciales — NO depende de
// variables de entorno globales, por lo que permite N cuentas
// SmartOLT distintas en la misma instalación del ERP.
//
// Endpoints SmartOLT utilizados:
//   GET  /api/olt/{id}                    — testConexion
//   GET  /api/olt/{id}/onu/unprovisioned  — descubrirOnus
//   GET  /api/onu/search?serial=X         — buscar ONU aprovisionada
//   GET  /api/olt/{id}/onu/{onuId}/signal — señal óptica
//   POST /api/onu/provision               — provisionar
//   DEL  /api/olt/{id}/onu/{onuId}        — desaprovisionar
// ─────────────────────────────────────────────────────────────
@Injectable()
export class SmartoltProvider implements IOltProvider {
  readonly tipo: TipoProveedor = 'smartolt';

  private readonly logger = new Logger(SmartoltProvider.name);

  constructor(private readonly http: HttpService) {}

  // ── HTTP helpers ─────────────────────────────────────────────

  private cfg(creds: ProveedorCredenciales): AxiosRequestConfig {
    return {
      baseURL: (creds.baseUrl ?? '').replace(/\/$/, ''),
      timeout: 30_000,
      headers: {
        'Authorization': `Bearer ${creds.apiKey ?? ''}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
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
  // SmartOLT usa formato "frame/slot/port" (ej. "0/1/3")
  private parsePonPort(ponPort: string): { slot: number; port: number } {
    const parts = (ponPort ?? '').split('/');
    return {
      slot: parseInt(parts[1] ?? '0', 10),
      port: parseInt(parts[2] ?? '0', 10),
    };
  }

  private buildPonPort(slot: number, port: number): string {
    return `0/${slot}/${port}`;
  }

  // ────────────────────────────────────────────────────────────
  // testConexion — intenta GET a la OLT en SmartOLT
  // ────────────────────────────────────────────────────────────
  async testConexion(
    _olt:  OltDispositivo,
    creds: ProveedorCredenciales,
  ): Promise<OltOperacionResult> {
    const t0 = Date.now();
    const oltId = creds.oltIdExterno ?? '';

    if (!oltId) {
      return { exitoso: false, mensaje: 'oltIdExterno no configurado en credenciales SmartOLT', latenciaMs: 0, proveedor: this.tipo };
    }

    try {
      const olt = await this.get<any>(creds, `/api/olt/${oltId}`);
      return {
        exitoso: true,
        mensaje: `SmartOLT conectado — OLT: ${olt?.name ?? oltId} (${olt?.status ?? 'desconocido'})`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      const status  = err?.response?.status;
      const mensaje = status === 401
        ? 'API Key inválida o sin permisos'
        : status === 404
          ? `OLT ID "${oltId}" no encontrada en SmartOLT`
          : err?.message ?? 'Error de conexión con SmartOLT';

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
      const oltId   = creds.oltIdExterno ?? '';
      const ponPort = this.buildPonPort(payload.slot, payload.port);

      const body = {
        serial:      payload.sn.toUpperCase(),
        olt_id:      oltId,
        pon_port:    ponPort,
        profile:     payload.profileSpeed,
        vlan:        payload.vlan,
        vlan_mode:   'access',
        description: olt.nombre,
      };

      const result = await this.post<any>(creds, '/api/onu/provision', body);

      if (!result?.id) {
        return { exitoso: false, mensaje: 'SmartOLT no retornó ID de ONU válido', latenciaMs: Date.now() - t0, proveedor: this.tipo };
      }

      return {
        exitoso: true,
        datos:   { oltIp: olt.ipGestion, onuSn: payload.sn, details: { smartolt_id: result.id, pon_port: ponPort } },
        mensaje: `ONU aprovisionada en SmartOLT — ID: ${result.id}`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      this.logger.error(`provisionar | OLT=${olt.nombre} SN=${payload.sn}: ${err?.message}`);
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Error al provisionar en SmartOLT';
      return { exitoso: false, mensaje: msg, latenciaMs: Date.now() - t0, proveedor: this.tipo };
    }
  }

  // ────────────────────────────────────────────────────────────
  // desaprovisionar — busca por serial y elimina por ID interno
  // ────────────────────────────────────────────────────────────
  async desaprovisionar(
    olt:     OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltDeprovisionPayload,
  ): Promise<OltOperacionResult<OltDeprovisionDatos>> {
    const t0 = Date.now();
    try {
      // Paso 1 — buscar ONU por serial para obtener ID interno SmartOLT
      const onus = await this.get<any[]>(creds, '/api/onu/search', { serial: payload.sn.toUpperCase() });
      const onu  = onus?.[0];

      if (!onu?.id) {
        // No existía en SmartOLT — considerar idempotente (ya eliminada)
        this.logger.warn(`desaprovisionar | SN=${payload.sn} no encontrada en SmartOLT — omitiendo`);
        return {
          exitoso: true,
          datos:   { oltIp: olt.ipGestion, onuId: payload.onuId, details: { skipped: true } },
          mensaje: `ONU ${payload.sn} no encontrada en SmartOLT (ya eliminada o nunca aprovisionada)`,
          latenciaMs: Date.now() - t0,
          proveedor: this.tipo,
        };
      }

      // Paso 2 — eliminar por ID y olt_id de SmartOLT
      await this.delete(creds, `/api/olt/${onu.olt_id}/onu/${onu.id}`);

      return {
        exitoso: true,
        datos:   { oltIp: olt.ipGestion, onuId: payload.onuId, details: { smartolt_id: onu.id } },
        mensaje: `ONU ${payload.sn} eliminada de SmartOLT`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      this.logger.error(`desaprovisionar | OLT=${olt.nombre} SN=${payload.sn}: ${err?.message}`);
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al desaprovisionar en SmartOLT';
      return { exitoso: false, mensaje: msg, latenciaMs: Date.now() - t0, proveedor: this.tipo };
    }
  }

  // ────────────────────────────────────────────────────────────
  // descubrirOnus — ONUs no autorizadas reportadas por SmartOLT
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
      const raw = await this.get<any[]>(creds, `/api/olt/${oltId}/onu/unprovisioned`);
      const todas = (raw ?? []).map((o) => {
        const { slot: s, port: p } = this.parsePonPort(o.pon_port ?? '');
        return { sn: o.serial ?? o.sn, slot: s, port: p } as OltOnuEncontrada;
      });

      // Filtro opcional por slot/port
      const filtradas = (slot !== undefined || port !== undefined)
        ? todas.filter((o) =>
            (slot === undefined || o.slot === slot) &&
            (port === undefined || o.port === port),
          )
        : todas;

      return {
        exitoso: true,
        datos:   filtradas,
        mensaje: `${filtradas.length} ONU(s) no aprovisionadas vía SmartOLT`,
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al descubrir ONUs en SmartOLT';
      return { exitoso: false, mensaje: msg, latenciaMs: Date.now() - t0, proveedor: this.tipo };
    }
  }

  // ────────────────────────────────────────────────────────────
  // obtenerMetricas — señal óptica via SmartOLT
  // ────────────────────────────────────────────────────────────
  async obtenerMetricas(
    _olt:    OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltMetricasPayload,
  ): Promise<OltOperacionResult<OltMetricasDatos>> {
    const t0 = Date.now();
    try {
      // Buscar ONU por serial para obtener ID interno y olt_id de SmartOLT
      const sn   = payload.sn ?? '';
      const onus = sn ? await this.get<any[]>(creds, '/api/onu/search', { serial: sn.toUpperCase() }) : [];
      const onu  = onus?.[0];

      if (!onu?.id) {
        return {
          exitoso: true,
          datos:   { status: 'offline', metricsAvailable: false },
          mensaje: `ONU ${sn || payload.onuId} no encontrada en SmartOLT`,
          latenciaMs: Date.now() - t0,
          proveedor: this.tipo,
        };
      }

      const signal = await this.get<any>(creds, `/api/olt/${onu.olt_id}/onu/${onu.id}/signal`);

      const datos: OltMetricasDatos = {
        status:           onu.status === 'online' ? 'online' : 'offline',
        metricsAvailable: true,
        rxPowerDbm:       signal?.rx_power    ?? null,
        txPowerDbm:       signal?.tx_power    ?? null,
        temperatureC:     signal?.temperature ?? null,
        alarm:            null,
      };

      return { exitoso: true, datos, mensaje: 'OK', latenciaMs: Date.now() - t0, proveedor: this.tipo };

    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al obtener métricas de SmartOLT';
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
