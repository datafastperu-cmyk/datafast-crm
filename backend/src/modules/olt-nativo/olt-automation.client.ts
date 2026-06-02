import {
  Injectable, Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { ConfigService }  from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosRequestConfig } from 'axios';

import {
  PythonBatchStatusRequest,
  PythonBatchStatusResponse,
  PythonDiscoverRequest,
  PythonDiscoverResponse,
  PythonFirmwareJobStatus,
  PythonFirmwareUpgradeRequest,
  PythonMetricsResponse,
  PythonProvisionRequest,
  PythonProvisionResponse,
} from './dto/olt-nativo-ops.dto';

// ─────────────────────────────────────────────────────────────
// OltAutomationClient
//
// Cliente HTTP hacia el microservicio Python de automatización.
// Ruta OpenVPN:  NestJS → 127.0.0.1:8001 → uvicorn/FastAPI
//                → OpenVPN tun0 → IP privada OLT
//
// Timeout: 30 s.  La sesión SSH física sobre VPN toma 5-10 s;
// el timeout deja margen para OLTs lentas o de alta carga.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltAutomationClient {
  private readonly logger  = new Logger(OltAutomationClient.name);
  private readonly baseUrl: string;
  private readonly apiKey:  string;

  private readonly TIMEOUT_MS = 30_000;

  constructor(
    private readonly http:   HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('app.oltAutomation.url', 'http://127.0.0.1:8001');
    this.apiKey  = config.get<string>('app.oltAutomation.internalApiKey', '');
  }

  // ────────────────────────────────────────────────────────────
  // Provisionar ONU (POST /api/v1/olt/provision)
  // ────────────────────────────────────────────────────────────
  async provision(payload: PythonProvisionRequest): Promise<PythonProvisionResponse> {
    this.logger.log(
      `→ Python provision | OLT=${payload.connection.ip} | SN=${payload.onu.sn}`,
    );
    const res = await this.post<PythonProvisionResponse>('/api/v1/olt/provision', payload);
    this.logger.log(
      `← Python provision | success=${res.success} | OLT=${res.olt_ip} | SN=${res.onu_sn}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Métricas ópticas (POST /api/v1/olt/metrics)
  // No propaga excepciones — devuelve respuesta controlada
  // ────────────────────────────────────────────────────────────
  async getMetrics(payload: PythonProvisionRequest): Promise<PythonMetricsResponse> {
    this.logger.log(
      `→ Python metrics | OLT=${payload.connection.ip} ` +
      `slot=${payload.onu.slot} port=${payload.onu.port} onuId=${payload.onu.onu_id}`,
    );
    const res = await this.post<PythonMetricsResponse>('/api/v1/olt/metrics', payload);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Estado y métricas masivos (POST /api/v1/olt/batch-status)
  //
  // Una sesión SSH por puerto PON — mucho más eficiente que N
  // sesiones individuales.  Usado exclusivamente por el cron de monitoreo.
  // ────────────────────────────────────────────────────────────
  async batchStatus(payload: PythonBatchStatusRequest): Promise<PythonBatchStatusResponse> {
    this.logger.log(
      `→ Python batch-status | OLT=${payload.connection.ip} | ONUs=${payload.onus.length}`,
    );
    const res = await this.post<PythonBatchStatusResponse>('/api/v1/olt/batch-status', payload);
    this.logger.log(
      `← Python batch-status | success=${res.success} | total=${res.total}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Descubrir ONUs no autorizadas (POST /api/v1/olt/discover-onus)
  // ────────────────────────────────────────────────────────────
  async discoverOnus(payload: PythonDiscoverRequest): Promise<PythonDiscoverResponse> {
    this.logger.log(
      `→ Python discover-onus | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot ?? '*'} port=${payload.port ?? '*'}`,
    );
    const res = await this.post<PythonDiscoverResponse>('/api/v1/olt/discover-onus', payload);
    this.logger.log(
      `← Python discover-onus | success=${res.success} | total=${res.total}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Firmware upgrade OMCI (POST /api/v1/olt/firmware-upgrade)
  //
  // Responde 202 inmediatamente con job_id.
  // El upgrade real corre como BackgroundTask en Python.
  // ────────────────────────────────────────────────────────────
  async firmwareUpgrade(
    payload: PythonFirmwareUpgradeRequest,
  ): Promise<{ status: string; job_id: string; message: string }> {
    this.logger.log(
      `→ Python firmware-upgrade | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} ONUs=${payload.onu_ids.length}`,
    );
    const res = await this.post<{ status: string; job_id: string; message: string }>(
      '/api/v1/olt/firmware-upgrade',
      payload,
    );
    this.logger.log(
      `← Python firmware-upgrade | job_id=${res.job_id} | status=${res.status}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Estado de un job de firmware (GET /api/v1/olt/firmware-job/{jobId})
  // ────────────────────────────────────────────────────────────
  async getFirmwareJobStatus(jobId: string): Promise<PythonFirmwareJobStatus> {
    return this.get<PythonFirmwareJobStatus>(`/api/v1/olt/firmware-job/${jobId}`);
  }

  // ────────────────────────────────────────────────────────────
  // Health check del microservicio Python
  // ────────────────────────────────────────────────────────────
  async health(): Promise<{ status: string; service: string }> {
    try {
      const res = await this.get<{ status: string; service: string }>('/api/v1/health');
      return res;
    } catch {
      return { status: 'unavailable', service: 'olt-automation-service' };
    }
  }

  // ────────────────────────────────────────────────────────────
  // HTTP helpers privados
  // ────────────────────────────────────────────────────────────

  private getConfig(): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'X-Service':    'DATAFAST-ERP',
    };
    if (this.apiKey) headers['X-Internal-Key'] = this.apiKey;
    return { headers, timeout: this.TIMEOUT_MS };
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
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

  private async get<T>(endpoint: string): Promise<T> {
    this.checkConfig();
    try {
      const res = await firstValueFrom(
        this.http.get<T>(`${this.baseUrl}${endpoint}`, this.getConfig()),
      );
      return res.data;
    } catch (error) {
      this.handleHttpError(error, 'GET', endpoint);
    }
  }

  private checkConfig(): void {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException(
        'OLT Automation Service no configurado. Verifica OLT_AUTOMATION_SERVICE_URL.',
      );
    }
  }

  private handleHttpError(error: any, method: string, endpoint: string): never {
    const status  = error?.response?.status;
    const detail  = error?.response?.data;
    const message = detail?.error || detail?.message || detail?.detail || error.message;
    const isNetworkError = !status;

    this.logger.error(
      `OltAutomation ${method} ${endpoint} → ` +
      `${status ?? 'sin respuesta'}: ${message}`,
    );

    if (isNetworkError) {
      throw new ServiceUnavailableException(
        `Microservicio OLT no alcanzable en ${this.baseUrl}. ` +
        `Verifica que el servicio esté corriendo: ${message}`,
      );
    }

    throw new ServiceUnavailableException(
      `Error microservicio OLT (${status}): ${message}`,
    );
  }
}
