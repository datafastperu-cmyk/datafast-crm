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
  PythonBoardTopologyRequest,
  PythonBoardTopologyResponse,
  PythonDeprovisionRequest,
  PythonDeprovisionResponse,
  PythonDiscoverRequest,
  PythonDiscoverResponse,
  PythonFirmwareJobStatus,
  PythonFirmwareUpgradeRequest,
  PythonFtthGponRequest,
  PythonFtthGponResponse,
  PythonFtthPollRequest,
  PythonFtthPollResponse,
  PythonFtthRollbackRequest,
  PythonFtthRollbackResponse,
  PythonFtthWanPppoeRequest,
  PythonFtthWanResponse,
  PythonListProfilesRequest,
  PythonListProfilesResponse,
  PythonMetricsResponse,
  PythonOntResetRequest,
  PythonOntResetResponse,
  PythonOntVersionRequest,
  PythonOntVersionResponse,
  PythonProvisionRequest,
  PythonProvisionResponse,
  PythonTestConexionRequest,
  PythonTestConexionResponse,
  PythonVerifyOnuRequest,
  PythonVerifyOnuResponse,
  PythonOntSuspendRequest,
  PythonOntSuspendResponse,
  PythonChangeLineprofileRequest,
  PythonChangeLineprofileResponse,
  PythonWizardTopologyRequest,
  PythonWizardTopologyResponse,
  PythonHealthSnapshotRequest,
  PythonHealthSnapshotResponse,
  PythonVlanAddRequest,
  PythonVlanAddResponse,
  PythonVlanDeleteRequest,
  PythonVlanDeleteResponse,
  PythonTrafficTableAddRequest,
  PythonTrafficTableAddResponse,
  PythonTrafficTableDeleteRequest,
  PythonTrafficTableDeleteResponse,
  PythonTrafficTableEditRequest,
  PythonTrafficTableEditResponse,
  PythonPonPortsRequest,
  PythonPonPortsResponse,
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
  // Prueba de conectividad SSH liviana (POST /api/v1/olt/test-connection)
  // ────────────────────────────────────────────────────────────
  async testConexionSsh(payload: PythonTestConexionRequest): Promise<PythonTestConexionResponse> {
    this.logger.log(`→ Python test-connection | OLT=${payload.connection.ip}`);
    const res = await this.post<PythonTestConexionResponse>('/api/v1/olt/test-connection', payload);
    this.logger.log(`← Python test-connection | success=${res.success} latency=${res.latency_ms}ms`);
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
    const res = await this.post<PythonDiscoverResponse>('/api/v1/olt/discover-onus', payload, 90_000);
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
  // Desaprovisionar ONU (POST /api/v1/olt/deprovision)
  // ────────────────────────────────────────────────────────────
  async deprovision(payload: PythonDeprovisionRequest): Promise<PythonDeprovisionResponse> {
    this.logger.log(
      `→ Python deprovision | OLT=${payload.connection.ip} ` +
      `slot=${payload.onu.slot} port=${payload.onu.port} onu_id=${payload.onu.onu_id}`,
    );
    const res = await this.post<PythonDeprovisionResponse>('/api/v1/olt/deprovision', payload);
    this.logger.log(
      `← Python deprovision | success=${res.success} | OLT=${res.olt_ip} | onu_id=${res.onu_id}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Verificar estado ONU post-aprovisionamiento (POST /api/v1/olt/verify-onu)
  // ────────────────────────────────────────────────────────────
  async verifyOnu(payload: PythonVerifyOnuRequest): Promise<PythonVerifyOnuResponse> {
    this.logger.log(
      `→ Python verify-onu | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id}`,
    );
    const res = await this.post<PythonVerifyOnuResponse>('/api/v1/olt/verify-onu', payload);
    this.logger.log(
      `← Python verify-onu | success=${res.success} | run_state=${res.run_state}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Listar perfiles MA5800 (POST /api/v1/olt/profiles)
  // ────────────────────────────────────────────────────────────
  async listProfiles(payload: PythonListProfilesRequest): Promise<PythonListProfilesResponse> {
    this.logger.log(`→ Python profiles | OLT=${payload.connection.ip}`);
    const res = await this.post<PythonListProfilesResponse>('/api/v1/olt/profiles', payload, 150_000);
    this.logger.log(
      `← Python profiles | lp=${res.lineprofiles?.length ?? 0} sp=${res.srvprofiles?.length ?? 0} tt=${res.traffic_tables?.length ?? 0}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Reiniciar ONU (POST /api/v1/olt/ont-reset)
  // ────────────────────────────────────────────────────────────
  async ontReset(payload: PythonOntResetRequest): Promise<PythonOntResetResponse> {
    this.logger.log(
      `→ Python ont-reset | OLT=${payload.connection.ip} slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id}`,
    );
    const res = await this.post<PythonOntResetResponse>('/api/v1/olt/ont-reset', payload);
    this.logger.log(`← Python ont-reset | success=${res.success}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Topología de slots/tarjetas (POST /api/v1/olt/board-topology)
  // ────────────────────────────────────────────────────────────
  async boardTopology(payload: PythonBoardTopologyRequest): Promise<PythonBoardTopologyResponse> {
    this.logger.log(`→ Python board-topology | OLT=${payload.connection.ip}`);
    const res = await this.post<PythonBoardTopologyResponse>('/api/v1/olt/board-topology', payload);
    this.logger.log(`← Python board-topology | slots=${res.slots?.length ?? 0}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Versión de firmware de una ONU (POST /api/v1/olt/ont-version)
  // ────────────────────────────────────────────────────────────
  async ontVersion(payload: PythonOntVersionRequest): Promise<PythonOntVersionResponse> {
    this.logger.log(
      `→ Python ont-version | OLT=${payload.connection.ip} slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id}`,
    );
    const res = await this.post<PythonOntVersionResponse>('/api/v1/olt/ont-version', payload);
    this.logger.log(`← Python ont-version | success=${res.success} sw=${res.software_version}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // FTTH — Fase 1: registrar ONU GPON en la OLT
  // ────────────────────────────────────────────────────────────
  async ftthProvisionGpon(payload: PythonFtthGponRequest): Promise<PythonFtthGponResponse> {
    this.logger.log(
      `→ Python ftth/provision-gpon | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id} sn=${payload.sn}`,
    );
    const res = await this.post<PythonFtthGponResponse>(
      '/api/v1/olt/ftth/provision-gpon', payload, 60_000,
    );
    this.logger.log(`← ftth/provision-gpon | success=${res.success}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // FTTH — Rollback GPON (eliminar ont + service-port)
  // ────────────────────────────────────────────────────────────
  async ftthRollbackGpon(payload: PythonFtthRollbackRequest): Promise<PythonFtthRollbackResponse> {
    this.logger.log(
      `→ Python ftth/rollback-gpon | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id}`,
    );
    const res = await this.post<PythonFtthRollbackResponse>(
      '/api/v1/olt/ftth/rollback-gpon', payload, 30_000,
    );
    this.logger.log(`← ftth/rollback-gpon | success=${res.success}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // FTTH — Fase 1b: esperar ONU online
  // ────────────────────────────────────────────────────────────
  async ftthPollOnline(payload: PythonFtthPollRequest): Promise<PythonFtthPollResponse> {
    this.logger.log(
      `→ Python ftth/poll-online | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id} max_wait=${payload.max_wait}s`,
    );
    const res = await this.post<PythonFtthPollResponse>(
      '/api/v1/olt/ftth/poll-online', payload, (payload.max_wait + 15) * 1_000,
    );
    this.logger.log(
      `← ftth/poll-online | success=${res.success} run_state=${res.run_state} timeout=${res.timeout}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // FTTH — Fase 2: inyectar config PPPoE vía OMCI
  // ────────────────────────────────────────────────────────────
  async ftthInjectWanPppoe(payload: PythonFtthWanPppoeRequest): Promise<PythonFtthWanResponse> {
    this.logger.log(
      `→ Python ftth/inject-wan-pppoe | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id}`,
    );
    const res = await this.post<PythonFtthWanResponse>(
      '/api/v1/olt/ftth/inject-wan-pppoe', payload, 30_000,
    );
    this.logger.log(`← ftth/inject-wan-pppoe | success=${res.success}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // FTTH — Suspensión / Rehabilitación ONU
  // ────────────────────────────────────────────────────────────
  async ftthSuspendOnu(payload: PythonOntSuspendRequest): Promise<PythonOntSuspendResponse> {
    this.logger.log(
      `→ Python ftth/suspend | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id} sp=${payload.service_port_id}`,
    );
    const res = await this.post<PythonOntSuspendResponse>('/api/v1/olt/ftth/suspend', payload, 30_000);
    this.logger.log(`← ftth/suspend | success=${res.success}`);
    return res;
  }

  async ftthChangeLineprofile(payload: PythonChangeLineprofileRequest): Promise<PythonChangeLineprofileResponse> {
    this.logger.log(
      `→ Python ftth/change-lineprofile | OLT=${payload.connection.ip} ` +
      `sp=${payload.service_port_id} traffic_index=${payload.traffic_index}`,
    );
    const res = await this.post<PythonChangeLineprofileResponse>('/api/v1/olt/ftth/change-lineprofile', payload, 30_000);
    this.logger.log(`← ftth/change-lineprofile | success=${res.success}`);
    return res;
  }

  async ftthRehabilitateOnu(payload: PythonOntSuspendRequest): Promise<PythonOntSuspendResponse> {
    this.logger.log(
      `→ Python ftth/rehabilitate | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id} sp=${payload.service_port_id}`,
    );
    const res = await this.post<PythonOntSuspendResponse>('/api/v1/olt/ftth/rehabilitate', payload, 30_000);
    this.logger.log(`← ftth/rehabilitate | success=${res.success}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Wizard: topología completa (POST /api/v1/olt/wizard/topology)
  // Una sesión SSH — boards, VLANs, traffic tables, perfiles
  // ────────────────────────────────────────────────────────────
  async wizardTopologia(payload: PythonWizardTopologyRequest): Promise<PythonWizardTopologyResponse> {
    this.logger.log(`→ Python wizard/topology | OLT=${payload.connection.ip}`);
    const res = await this.post<PythonWizardTopologyResponse>(
      '/api/v1/olt/wizard/topology', payload, 150_000,
    );
    this.logger.log(
      `← Python wizard/topology | success=${res.success} boards=${res.boards?.length ?? 0} vlans=${res.vlans?.length ?? 0}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Health Snapshot (boards + POM opcional)
  // ────────────────────────────────────────────────────────────
  async healthSnapshot(payload: PythonHealthSnapshotRequest): Promise<PythonHealthSnapshotResponse> {
    const res = await this.post<PythonHealthSnapshotResponse>(
      '/api/v1/olt/health/snapshot', payload, 90_000,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // VLAN CLI (POST /api/v1/olt/vlan/add | /delete)
  // ────────────────────────────────────────────────────────────
  async vlanAdd(payload: PythonVlanAddRequest): Promise<PythonVlanAddResponse> {
    this.logger.log(`→ Python vlan/add | OLT=${payload.connection.ip} vlan_id=${payload.vlan_id}`);
    const res = await this.post<PythonVlanAddResponse>('/api/v1/olt/vlan/add', payload, 30_000);
    this.logger.log(`← Python vlan/add | success=${res.success}`);
    return res;
  }

  async vlanDelete(payload: PythonVlanDeleteRequest): Promise<PythonVlanDeleteResponse> {
    this.logger.log(`→ Python vlan/delete | OLT=${payload.connection.ip} vlan_id=${payload.vlan_id}`);
    const res = await this.post<PythonVlanDeleteResponse>('/api/v1/olt/vlan/delete', payload, 30_000);
    this.logger.log(`← Python vlan/delete | success=${res.success}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Traffic Table CLI (POST /api/v1/olt/traffic-table/*)
  // ────────────────────────────────────────────────────────────
  async trafficTableAdd(payload: PythonTrafficTableAddRequest): Promise<PythonTrafficTableAddResponse> {
    this.logger.log(`→ Python traffic-table/add | OLT=${payload.connection.ip} name=${payload.name}`);
    const res = await this.post<PythonTrafficTableAddResponse>('/api/v1/olt/traffic-table/add', payload, 30_000);
    this.logger.log(`← Python traffic-table/add | success=${res.success} index=${res.index}`);
    return res;
  }

  async trafficTableDelete(payload: PythonTrafficTableDeleteRequest): Promise<PythonTrafficTableDeleteResponse> {
    this.logger.log(`→ Python traffic-table/delete | OLT=${payload.connection.ip} index=${payload.index}`);
    const res = await this.post<PythonTrafficTableDeleteResponse>('/api/v1/olt/traffic-table/delete', payload, 30_000);
    this.logger.log(`← Python traffic-table/delete | success=${res.success}`);
    return res;
  }

  async trafficTableEdit(payload: PythonTrafficTableEditRequest): Promise<PythonTrafficTableEditResponse> {
    this.logger.log(`→ Python traffic-table/edit | OLT=${payload.connection.ip} index=${payload.index} name=${payload.name}`);
    const res = await this.post<PythonTrafficTableEditResponse>('/api/v1/olt/traffic-table/edit', payload, 60_000);
    this.logger.log(`← Python traffic-table/edit | success=${res.success} new_index=${res.new_index}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // PON Port Health — estado operativo por puerto de un slot
  // (POST /api/v1/olt/health/pon-ports)
  // Timeout 120s: 16 comandos en 1 sesión SSH (~5s c/u)
  // ────────────────────────────────────────────────────────────
  async ponPorts(payload: PythonPonPortsRequest): Promise<PythonPonPortsResponse> {
    this.logger.log(`→ Python health/pon-ports | OLT=${payload.connection.ip} slot=${payload.slot}`);
    const res = await this.post<PythonPonPortsResponse>(
      '/api/v1/olt/health/pon-ports', payload, 120_000,
    );
    this.logger.log(
      `← Python health/pon-ports | success=${res.success} ports=${res.ports?.length ?? 0}`,
    );
    return res;
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
    headers['X-Internal-Key'] = this.apiKey;
    return { headers, timeout: this.TIMEOUT_MS };
  }

  private async post<T>(endpoint: string, body: unknown, timeoutMs?: number): Promise<T> {
    this.checkConfig();
    try {
      const cfg = timeoutMs ? { ...this.getConfig(), timeout: timeoutMs } : this.getConfig();
      const res = await firstValueFrom(
        this.http.post<T>(`${this.baseUrl}${endpoint}`, body, cfg),
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
    // FastAPI 422: detail es un array [{loc, msg, type}]
    const rawDetail = detail?.error || detail?.message || detail?.detail;
    const message = Array.isArray(rawDetail)
      ? rawDetail.map((e: any) => `${e.loc?.slice(-1)[0] ?? 'campo'}: ${e.msg}`).join('; ')
      : (rawDetail ?? error.message);
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
