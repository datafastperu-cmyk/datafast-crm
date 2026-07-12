import { Injectable, Logger } from '@nestjs/common';
import { HttpService }        from '@nestjs/axios';
import { ConfigService }      from '@nestjs/config';
import { firstValueFrom }     from 'rxjs';
import type { AxiosRequestConfig } from 'axios';

// ─────────────────────────────────────────────────────────────
// Tr069GenieacsClient — wrapper del Northbound Interface (NBI) REST de GenieACS.
//
// El ERP NO habla CWMP: habla REST con GenieACS, que a su vez habla CWMP con las
// ONUs/ONTs (CPE). NBI por defecto en :7557, solo accesible en localhost/VPN.
//
// Escritura asíncrona: encolar una task devuelve 200 (aplicada en la sesión actual
// si el CPE está conectado) o 202 (encolada hasta el próximo Inform). El caller trata
// ambos como éxito de ENCOLADO; la aplicación real es eventual.
// ─────────────────────────────────────────────────────────────

export interface GenieTask {
  name: 'setParameterValues' | 'getParameterValues' | 'refreshObject'
      | 'reboot' | 'factoryReset' | 'download' | 'addObject' | 'deleteObject';
  parameterValues?: Array<[string, unknown, string?]>;
  parameterNames?:  string[];
  objectName?:      string;
  fileType?:        string;
  fileName?:        string;
}

@Injectable()
export class Tr069GenieacsClient {
  private readonly logger = new Logger(Tr069GenieacsClient.name);
  private readonly baseUrl: string;
  private readonly auth?: { username: string; password: string };
  private readonly TIMEOUT_MS = 15_000;

  constructor(
    private readonly http:   HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = (this.config.get<string>('app.genieacs.nbiUrl') ?? '').replace(/\/$/, '');
    const user = this.config.get<string>('app.genieacs.user') ?? '';
    const pass = this.config.get<string>('app.genieacs.pass') ?? '';
    if (user) this.auth = { username: user, password: pass };
  }

  /** ¿Hay ACS configurado? Vacío → el módulo arranca degradado. */
  isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  private cfg(extra?: AxiosRequestConfig): AxiosRequestConfig {
    return {
      timeout: this.TIMEOUT_MS,
      ...(this.auth ? { auth: this.auth } : {}),
      ...extra,
    };
  }

  /** Probe ligero del NBI (query mínima). No lanza; retorna {ok,error}. */
  async probe(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: 'GENIEACS_NBI_URL no configurado' };
    try {
      const q = encodeURIComponent(JSON.stringify({ _id: '__probe__' }));
      await firstValueFrom(
        this.http.get(`${this.baseUrl}/devices/?query=${q}&projection=_id`, this.cfg({ timeout: 5_000 })),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Lista devices por query GenieACS (Mongo-like). projection = campos separados por coma. */
  async listDevices(query: Record<string, unknown> = {}, projection?: string): Promise<any[]> {
    const q = encodeURIComponent(JSON.stringify(query));
    let url = `${this.baseUrl}/devices/?query=${q}`;
    if (projection) url += `&projection=${encodeURIComponent(projection)}`;
    const res = await firstValueFrom(this.http.get<any[]>(url, this.cfg()));
    return res.data ?? [];
  }

  async getDevice(deviceId: string): Promise<any | null> {
    const rows = await this.listDevices({ _id: deviceId });
    return rows[0] ?? null;
  }

  /**
   * Encola una task para un device. connectionRequest=true intenta aplicar YA
   * (connection-request al CPE); si el CPE no es alcanzable (NAT/offline) queda
   * encolada hasta el próximo Inform. Retorna el status HTTP (200 aplicada / 202 encolada).
   */
  async queueTask(deviceId: string, task: GenieTask, connectionRequest = true): Promise<{ status: number; body: unknown }> {
    const cr = connectionRequest ? '?connection_request' : '';
    const res = await firstValueFrom(
      this.http.post(`${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/tasks${cr}`, task, this.cfg()),
    );
    return { status: res.status, body: res.data };
  }

  /** Agrega un tag al device (idempotente). Usado como guard del pipeline (Provisioned/…). */
  async addTag(deviceId: string, tag: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(tag)}`,
        null, this.cfg(),
      ),
    );
  }

  /** Quita un tag del device (idempotente). */
  async removeTag(deviceId: string, tag: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(
        `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(tag)}`,
        this.cfg(),
      ),
    );
  }

  /** Lista faults del device (opcionalmente de un canal concreto, p.ej. `task_<id>`). */
  async getFaults(deviceId: string, channel?: string): Promise<Array<{ _id: string; channel?: string; code?: string; message?: string }>> {
    const query: Record<string, unknown> = { device: deviceId };
    if (channel) query.channel = channel;
    const q = encodeURIComponent(JSON.stringify(query));
    const res = await firstValueFrom(this.http.get<any[]>(`${this.baseUrl}/faults/?query=${q}`, this.cfg()));
    return res.data ?? [];
  }

  /** Borra un fault por id (`<device>:<channel>`). Libera el canal para reintentar. */
  async deleteFault(faultId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.baseUrl}/faults/${encodeURIComponent(faultId)}`, this.cfg()));
  }

  /** Borra una task encolada por id. */
  async deleteTask(taskId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`, this.cfg()));
  }
}
