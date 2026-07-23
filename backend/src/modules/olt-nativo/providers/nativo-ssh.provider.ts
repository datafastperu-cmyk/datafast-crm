import { Injectable, Logger } from '@nestjs/common';

import { OltDispositivo }      from '../entities/olt-dispositivo.entity';
import { TipoProveedor }       from '../entities/olt-proveedor-config.entity';
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
import { OltAutomationClient } from '../olt-automation.client';

// ─────────────────────────────────────────────────────────────
// NativoSshProvider
//
// Adaptador que envuelve OltAutomationClient (→ Python FastAPI
// → Netmiko → SSH directo a la OLT por VPN).
//
// NUNCA lanza excepciones al llamador — todo error se captura
// y se retorna como OltOperacionResult { exitoso: false }.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class NativoSshProvider implements IOltProvider {
  readonly tipo: TipoProveedor = 'nativo_ssh';

  private readonly logger = new Logger(NativoSshProvider.name);

  constructor(private readonly automation: OltAutomationClient) {}

  // ── Helpers de construcción de payload ───────────────────────

  private conn(creds: ProveedorCredenciales, olt?: OltDispositivo) {
    // PostgreSQL INET devuelve "10.0.0.1/32" — Python solo acepta "10.0.0.1"
    const rawIp = creds.ip ?? olt?.ipGestion ?? '';
    const ip    = rawIp.includes('/') ? rawIp.split('/')[0] : rawIp;
    return {
      ip,
      port:     creds.port     ?? 22,
      username: creds.username ?? '',
      password: creds.password ?? '',
      brand:    creds.brand    || olt?.marca || '',
    };
  }

  // ────────────────────────────────────────────────────────────
  // testConexion — abre/cierra SSH sin ejecutar comandos
  // ────────────────────────────────────────────────────────────
  async testConexion(
    olt:   OltDispositivo,
    creds: ProveedorCredenciales,
  ): Promise<OltOperacionResult> {
    const t0 = Date.now();
    try {
      const res = await this.automation.testConexionSsh({ connection: this.conn(creds, olt) });
      const latenciaMs = Date.now() - t0;
      if (res.success) {
        return { exitoso: true, mensaje: 'Conexión SSH exitosa', latenciaMs, proveedor: this.tipo };
      }
      return {
        exitoso: false,
        mensaje: res.error ?? 'Fallo de conexión SSH',
        latenciaMs: res.latency_ms ?? latenciaMs,
        proveedor: this.tipo,
      };
    } catch (err: any) {
      return {
        exitoso: false,
        mensaje: err?.response?.data?.message ?? err?.message ?? 'Error desconocido',
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
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
      const res = await this.automation.provision({
        connection: this.conn(creds, olt),
        onu: {
          frame:          payload.frame         ?? 0,
          slot:           payload.slot,
          port:           payload.port,
          onu_id:         payload.onuId,
          sn:             payload.sn,
          vlan:           payload.vlan,
          vlan_gestion:   payload.vlanGestion,
          profile_speed:  payload.profileSpeed,
          service_port_id: payload.servicePortId,
          traffic_index:  payload.trafficIndex,
          onu_type:       payload.onuType,
          onu_mode:       payload.onuMode,
        },
      });

      const latenciaMs = Date.now() - t0;

      if (res.success) {
        return {
          exitoso: true,
          datos:   { oltIp: res.olt_ip, onuSn: res.onu_sn, details: res.details },
          mensaje: res.message,
          latenciaMs,
          proveedor: this.tipo,
        };
      }
      return { exitoso: false, mensaje: res.message, latenciaMs, proveedor: this.tipo };

    } catch (err: any) {
      this.logger.error(`provisionar | OLT=${olt.nombre} SN=${payload.sn}: ${err?.message}`);
      return {
        exitoso: false,
        mensaje: err?.response?.data?.message ?? err?.message ?? 'Error al provisionar',
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
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
      const res = await this.automation.deprovision({
        connection: this.conn(creds, olt),
        onu: {
          slot:            payload.slot,
          port:            payload.port,
          onu_id:          payload.onuId,
          service_port_id: payload.servicePortId ?? null,
          rack:            0,   // frame 0 por defecto; Huawei lo ignora en deprovision
        },
      });

      const latenciaMs = Date.now() - t0;

      if (res.success) {
        return {
          exitoso: true,
          datos:   { oltIp: res.olt_ip, onuId: res.onu_id, details: res.details },
          mensaje: res.message,
          latenciaMs,
          proveedor: this.tipo,
        };
      }
      return { exitoso: false, mensaje: res.message, latenciaMs, proveedor: this.tipo };

    } catch (err: any) {
      this.logger.error(`desaprovisionar | OLT=${olt.nombre} SN=${payload.sn}: ${err?.message}`);
      return {
        exitoso: false,
        mensaje: err?.response?.data?.message ?? err?.message ?? 'Error al desaprovisionar',
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // descubrirOnus — ONUs no autorizadas en un slot/puerto o toda la OLT
  // ────────────────────────────────────────────────────────────
  async descubrirOnus(
    olt:   OltDispositivo,
    creds: ProveedorCredenciales,
    slot?: number,
    port?: number,
  ): Promise<OltOperacionResult<OltOnuEncontrada[]>> {
    const t0 = Date.now();
    try {
      const res = await this.automation.discoverOnus({
        connection: this.conn(creds, olt),
        slot:       slot ?? null,
        port:       port ?? null,
      });

      const latenciaMs = Date.now() - t0;

      if (res.success) {
        const onus: OltOnuEncontrada[] = res.onus.map((o) => ({
          sn:        o.sn,
          slot:      o.slot,
          port:      o.port,
          ont_model: o.ont_model ?? null,
        }));
        return { exitoso: true, datos: onus, mensaje: `${onus.length} ONU(s) encontradas`, latenciaMs, proveedor: this.tipo };
      }
      return { exitoso: false, mensaje: res.error ?? 'Error al descubrir ONUs', latenciaMs, proveedor: this.tipo };

    } catch (err: any) {
      return {
        exitoso: false,
        mensaje: err?.response?.data?.message ?? err?.message ?? 'Error al descubrir ONUs',
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // obtenerMetricas — RxPower, TxPower, Temperatura en tiempo real
  // ────────────────────────────────────────────────────────────
  // Normaliza el SN a 16 hex que exige el esquema Python. Acepta la forma hex tal cual y
  // convierte la legible (4 letras de fabricante + 8 hex → hex(ASCII)+hex). Si no encaja en
  // ningún patrón, devuelve un placeholder válido: el SN no interviene en la lectura óptica
  // (esa usa slot/port/onu_id), así que basta con que pase la validación del esquema.
  private _snHex(sn?: string): string {
    const s = (sn ?? '').trim().toUpperCase();
    if (/^[0-9A-F]{16}$/.test(s)) return s;
    const m = /^([A-Z]{4})([0-9A-F]{8})$/.exec(s);
    if (m) {
      const vendor = [...m[1]].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      return (vendor + m[2]).toUpperCase();
    }
    return '00000000DEADBEEF';
  }

  async obtenerMetricas(
    olt:     OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltMetricasPayload,
  ): Promise<OltOperacionResult<OltMetricasDatos>> {
    const t0 = Date.now();
    try {
      // getMetrics reutiliza PythonProvisionRequest; solo slot/port/onu_id importan para la
      // lectura óptica. El SN NO se usa en el comando, pero el esquema Python exige 16 hex y
      // rechaza (422) el SN en forma legible (p.ej. 'HWTC78CA0FAA') que guarda el registro
      // FTTH — por eso la señal no aparecía en el modal de aprovisionar. Se normaliza aquí.
      const res = await this.automation.getMetrics({
        connection: this.conn(creds, olt),
        onu: {
          frame:         0,
          slot:          payload.slot,
          port:          payload.port,
          onu_id:        payload.onuId,
          sn:            this._snHex(payload.sn),
          vlan:          1,
          vlan_gestion:  1,
          profile_speed: 'metrics',
        },
      });

      const latenciaMs = Date.now() - t0;

      const datos: OltMetricasDatos = {
        status:           res.success ? 'online' : 'offline',
        metricsAvailable: res.success && !res.error,
        rxPowerDbm:       res.rx_power_dbm,
        txPowerDbm:       res.tx_power_dbm,
        oltRxPowerDbm:    res.olt_rx_power_dbm ?? null,
        temperatureC:     res.temperature_c,
        alarm:            res.alarm ?? null,
      };

      return { exitoso: true, datos, mensaje: res.error ?? 'OK', latenciaMs, proveedor: this.tipo };

    } catch (err: any) {
      return {
        exitoso: false,
        datos: { status: 'offline', metricsAvailable: false },
        mensaje: err?.response?.data?.message ?? err?.message ?? 'Error al obtener métricas',
        latenciaMs: Date.now() - t0,
        proveedor: this.tipo,
      };
    }
  }
}
