import {
  Injectable, Logger, BadRequestException,
  ServiceUnavailableException, NotFoundException,
} from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { ConfigService }  from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosRequestConfig } from 'axios';

// ─── Tipos de la API SmartOLT ─────────────────────────────────
export interface SmartoltOnu {
  id:           string;
  serial:       string;
  pon_port:     string;      // '0/1/3'
  pon_type:     string;      // 'GPON' | 'EPON'
  status:       string;      // 'online' | 'offline' | 'unregistered'
  profile:      string;
  vlan:         number;
  description?: string;
  model?:       string;
  rx_power?:    number;      // dBm
  tx_power?:    number;
  temperature?: number;
  distance_km?: number;
  uptime?:      string;
  last_seen?:   string;
  olt_id:       string;
  created_at?:  string;
}

export interface SmartoltOnuNoAprovisionada {
  serial:    string;
  pon_port:  string;
  pon_type:  string;
  olt_id:    string;
  detected_at?: string;
  model?:    string;
}

export interface SmartoltProfile {
  id:         string;
  name:       string;
  vlan?:      number;
  bandwidth?: string;
  type:       string;   // 'bridge' | 'router'
}

export interface SmartoltOlt {
  id:         string;
  name:       string;
  ip:         string;
  model:      string;
  status:     string;
  onu_count:  number;
  pon_ports:  number;
}

export interface ProvisionarOnuPayload {
  serial:      string;
  olt_id:      string;
  pon_port:    string;
  profile:     string;
  vlan:        number;
  description?: string;
  vlan_mode?:   string;    // 'access' | 'trunk'
}

// ─────────────────────────────────────────────────────────────
// Cliente HTTP para la API de SmartOLT
// Documentación SmartOLT: https://smartolt.com/api-docs
// ─────────────────────────────────────────────────────────────
@Injectable()
export class SmartoltApiService {
  private readonly logger  = new Logger(SmartoltApiService.name);
  private readonly baseUrl: string;
  private readonly token:   string;

  // Timeout generoso para SmartOLT (puede tardar al consultar OLTs remotas)
  private readonly TIMEOUT_MS = 30_000;

  constructor(
    private readonly http:   HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('app.smartolt.url', '');
    this.token   = config.get<string>('app.smartolt.token', '');
  }

  // ────────────────────────────────────────────────────────────
  // OLTs
  // ────────────────────────────────────────────────────────────

  async listarOlts(): Promise<SmartoltOlt[]> {
    const res = await this.get<SmartoltOlt[]>('/api/olt');
    return res || [];
  }

  async getOlt(oltId: string): Promise<SmartoltOlt> {
    const olt = await this.get<SmartoltOlt>(`/api/olt/${oltId}`);
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada en SmartOLT`);
    return olt;
  }

  // ────────────────────────────────────────────────────────────
  // ONUs APROVISIONADAS
  // ────────────────────────────────────────────────────────────

  async listarOnusDeOlt(oltId: string): Promise<SmartoltOnu[]> {
    const res = await this.get<SmartoltOnu[]>(`/api/olt/${oltId}/onu`);
    return res || [];
  }

  async getOnu(oltId: string, onuId: string): Promise<SmartoltOnu> {
    const onu = await this.get<SmartoltOnu>(`/api/olt/${oltId}/onu/${onuId}`);
    if (!onu) throw new NotFoundException(`ONU ${onuId} no encontrada en SmartOLT`);
    return onu;
  }

  async getOnuBySerial(serial: string): Promise<SmartoltOnu | null> {
    try {
      const res = await this.get<SmartoltOnu[]>(`/api/onu/search`, { serial });
      return res?.[0] || null;
    } catch {
      return null;
    }
  }

  // Señal óptica en tiempo real
  async getSeñalOnu(oltId: string, onuId: string): Promise<{
    rxPower: number; txPower: number; temperature: number; voltaje: number;
  }> {
    const data = await this.get<any>(`/api/olt/${oltId}/onu/${onuId}/signal`);
    return {
      rxPower:     data?.rx_power    || 0,
      txPower:     data?.tx_power    || 0,
      temperature: data?.temperature || 0,
      voltaje:     data?.voltage     || 0,
    };
  }

  // ────────────────────────────────────────────────────────────
  // ONUs NO APROVISIONADAS (detectadas pero sin perfil)
  // ────────────────────────────────────────────────────────────

  async listarOnusNoAprovisionadas(oltId?: string): Promise<SmartoltOnuNoAprovisionada[]> {
    const endpoint = oltId
      ? `/api/olt/${oltId}/onu/unprovisioned`
      : `/api/onu/unprovisioned`;

    const res = await this.get<SmartoltOnuNoAprovisionada[]>(endpoint);
    return res || [];
  }

  async detectarOnuEnPuerto(
    oltId:   string,
    ponPort: string,
  ): Promise<SmartoltOnuNoAprovisionada | null> {
    const todas = await this.listarOnusNoAprovisionadas(oltId);
    return todas.find((o) => o.pon_port === ponPort) || null;
  }

  // ────────────────────────────────────────────────────────────
  // PERFILES DE SERVICIO
  // ────────────────────────────────────────────────────────────

  async listarPerfiles(): Promise<SmartoltProfile[]> {
    const res = await this.get<SmartoltProfile[]>('/api/profile');
    return res || [];
  }

  async getPerfilPorNombre(nombre: string): Promise<SmartoltProfile | null> {
    const perfiles = await this.listarPerfiles();
    return perfiles.find(
      (p) => p.name.toLowerCase() === nombre.toLowerCase(),
    ) || null;
  }

  // ────────────────────────────────────────────────────────────
  // APROVISIONAMIENTO
  // ────────────────────────────────────────────────────────────

  async aprovisionarOnu(payload: ProvisionarOnuPayload): Promise<SmartoltOnu> {
    this.logger.log(
      `Aprovisionando ONU: SN=${payload.serial} | ` +
      `OLT=${payload.olt_id} | PON=${payload.pon_port} | ` +
      `Perfil=${payload.profile} | VLAN=${payload.vlan}`,
    );

    const body = {
      serial:      payload.serial.toUpperCase(),
      olt_id:      payload.olt_id,
      pon_port:    payload.pon_port,
      profile:     payload.profile,
      vlan:        payload.vlan,
      vlan_mode:   payload.vlan_mode || 'access',
      description: payload.description || '',
    };

    const onu = await this.post<SmartoltOnu>('/api/onu/provision', body);

    if (!onu?.id) {
      throw new BadRequestException(
        `SmartOLT no retornó un ID de ONU válido para SN ${payload.serial}`,
      );
    }

    this.logger.log(`ONU aprovisionada: ID=${onu.id} | SN=${payload.serial}`);
    return onu;
  }

  // ────────────────────────────────────────────────────────────
  // ELIMINAR PROVISIÓN
  // ────────────────────────────────────────────────────────────

  async eliminarProvision(oltId: string, onuId: string): Promise<void> {
    this.logger.log(`Eliminando provisión ONU: ID=${onuId} en OLT=${oltId}`);
    await this.delete(`/api/olt/${oltId}/onu/${onuId}`);
    this.logger.log(`Provisión eliminada: ONU ${onuId}`);
  }

  async eliminarProvisionPorSerial(serial: string): Promise<void> {
    const onu = await this.getOnuBySerial(serial);
    if (!onu) {
      this.logger.warn(`ONU con SN ${serial} no encontrada en SmartOLT — omitiendo eliminación`);
      return;
    }
    await this.eliminarProvision(onu.olt_id, onu.id);
  }

  // ────────────────────────────────────────────────────────────
  // REINICIAR ONU
  // ────────────────────────────────────────────────────────────

  async reiniciarOnu(oltId: string, onuId: string): Promise<void> {
    await this.post(`/api/olt/${oltId}/onu/${onuId}/reboot`, {});
    this.logger.log(`ONU reiniciada: ${onuId}`);
  }

  // ────────────────────────────────────────────────────────────
  // ACTUALIZAR PERFIL/VLAN DE ONU EXISTENTE
  // ────────────────────────────────────────────────────────────

  async actualizarOnu(
    oltId: string,
    onuId: string,
    params: { profile?: string; vlan?: number; description?: string },
  ): Promise<SmartoltOnu> {
    const onu = await this.put<SmartoltOnu>(
      `/api/olt/${oltId}/onu/${onuId}`,
      params,
    );
    this.logger.log(`ONU actualizada: ${onuId}`);
    return onu;
  }

  // ────────────────────────────────────────────────────────────
  // ESTADÍSTICAS DEL OLT
  // ────────────────────────────────────────────────────────────

  async getEstadisticasOlt(oltId: string): Promise<{
    onusOnline: number; onusOffline: number; onusTotal: number;
    rxPromedio: number; txPromedio: number;
  }> {
    const data = await this.get<any>(`/api/olt/${oltId}/stats`).catch(() => null);
    return {
      onusOnline:  data?.onu_online  || 0,
      onusOffline: data?.onu_offline || 0,
      onusTotal:   data?.onu_total   || 0,
      rxPromedio:  data?.rx_avg      || 0,
      txPromedio:  data?.tx_avg      || 0,
    };
  }

  // ────────────────────────────────────────────────────────────
  // VERIFICAR CONECTIVIDAD CON SMARTOLT
  // ────────────────────────────────────────────────────────────

  async verificarConectividad(): Promise<{ conectado: boolean; version?: string; mensaje: string }> {
    if (!this.baseUrl || !this.token) {
      return { conectado: false, mensaje: 'SmartOLT no está configurado (SMARTOLT_URL o SMARTOLT_TOKEN vacíos)' };
    }

    try {
      const data = await this.get<any>('/api/health');
      return {
        conectado: true,
        version:   data?.version,
        mensaje:   `SmartOLT conectado | versión: ${data?.version || 'desconocida'}`,
      };
    } catch (error) {
      return {
        conectado: false,
        mensaje:   `No se pudo conectar a SmartOLT: ${error.message}`,
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS HTTP PRIVADOS
  // ────────────────────────────────────────────────────────────

  private getHeaders(): Record<string, string> {
    return {
      'Authorization':  `Bearer ${this.token}`,
      'Content-Type':   'application/json',
      'Accept':         'application/json',
      'X-Client':       'FibraNet-ISP/1.0',
    };
  }

  private getConfig(params?: Record<string, any>): AxiosRequestConfig {
    return {
      headers: this.getHeaders(),
      timeout: this.TIMEOUT_MS,
      params,
    };
  }

  private checkConfig(): void {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException(
        'SmartOLT no está configurado. Verifica SMARTOLT_URL en las variables de entorno.',
      );
    }
    if (!this.token) {
      throw new ServiceUnavailableException(
        'SmartOLT sin token de autenticación. Verifica SMARTOLT_TOKEN.',
      );
    }
  }

  private async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    this.checkConfig();
    try {
      const res = await firstValueFrom(
        this.http.get<T>(`${this.baseUrl}${endpoint}`, this.getConfig(params)),
      );
      return res.data;
    } catch (error) {
      this.handleHttpError(error, 'GET', endpoint);
    }
  }

  private async post<T>(endpoint: string, body: any): Promise<T> {
    this.checkConfig();
    try {
      const res = await firstValueFrom(
        this.http.post<T>(`${this.baseUrl}${endpoint}`, body, this.getConfig()),
      );
      return res.data;
    } catch (error) {
      this.handleHttpError(error, 'POST', endpoint);
    }
  }

  private async put<T>(endpoint: string, body: any): Promise<T> {
    this.checkConfig();
    try {
      const res = await firstValueFrom(
        this.http.put<T>(`${this.baseUrl}${endpoint}`, body, this.getConfig()),
      );
      return res.data;
    } catch (error) {
      this.handleHttpError(error, 'PUT', endpoint);
    }
  }

  private async delete(endpoint: string): Promise<void> {
    this.checkConfig();
    try {
      await firstValueFrom(
        this.http.delete(`${this.baseUrl}${endpoint}`, this.getConfig()),
      );
    } catch (error) {
      this.handleHttpError(error, 'DELETE', endpoint);
    }
  }

  private handleHttpError(error: any, method: string, endpoint: string): never {
    const status   = error?.response?.status;
    const detail   = error?.response?.data;
    const message  = detail?.message || detail?.error || error.message;

    this.logger.error(
      `SmartOLT ${method} ${endpoint} → ${status || 'sin respuesta'}: ${message}`,
    );

    if (status === 404) {
      throw new NotFoundException(`SmartOLT: recurso no encontrado (${endpoint})`);
    }
    if (status === 400) {
      throw new BadRequestException(
        `SmartOLT rechazó la solicitud: ${message}`,
      );
    }
    if (status === 401 || status === 403) {
      throw new ServiceUnavailableException(
        'Token de SmartOLT inválido o expirado. Verifica SMARTOLT_TOKEN.',
      );
    }
    if (!status) {
      throw new ServiceUnavailableException(
        `SmartOLT no disponible: ${message}. Verifica SMARTOLT_URL.`,
      );
    }

    throw new ServiceUnavailableException(
      `Error SmartOLT (${status}): ${message}`,
    );
  }
}
