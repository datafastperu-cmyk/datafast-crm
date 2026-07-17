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
  PythonFtthBootstrapRequest,
  PythonFtthBootstrapResponse,
  PythonFtthGponRequest,
  PythonFtthGponResponse,
  PythonFtthPollRequest,
  PythonFtthPollResponse,
  PythonFtthCheckWanRequest,
  PythonFtthCheckWanResponse,
  PythonFtthRollbackRequest,
  PythonFtthOntIdsRequest,
  PythonFtthOntIdsResponse,
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
  PythonSnmpNtpConfigRequest,
  PythonSnmpNtpConfigResponse,
  PythonApplyNtpServersRequest,
  PythonApplyNtpServersResponse,
  PythonServicePortsRequest,
  PythonServicePortsResponse,
  PythonHealthSnapshotRequest,
  PythonHealthSnapshotResponse,
  PythonVlanAddRequest,
  PythonVersionInfoRequest,
  PythonVersionInfoResponse,
  PythonSrvProfileAddRequest,
  PythonSrvProfileAddResponse,
  PythonSrvProfileDeleteRequest,
  PythonSrvProfileDeleteResponse,
  PythonLineProfileAddRequest,
  PythonLineProfileAddResponse,
  PythonLineProfileDeleteRequest,
  PythonLineProfileDeleteResponse,
  PythonUplinkVlansRequest,
  PythonUplinkVlansResponse,
  PythonUplinkTagRequest,
  PythonUplinkTagResponse,
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
  PythonClassifyOnusRequest,
  PythonClassifyOnusResponse,
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
    const res = await this.post<PythonBatchStatusResponse>('/api/v1/olt/batch-status', payload, 90_000);
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
    // 45s (> default 30s, < 60s del frontend): el reset en python hace SSH connect +
    // read_timeout 60s + reintentos con backoff; con 30s el backend abortaba con falso
    // fallo mientras la ONU sí se reiniciaba. Debe quedar por debajo del timeout del
    // frontend para que sea el backend quien devuelva el error limpio primero.
    const res = await this.post<PythonOntResetResponse>('/api/v1/olt/ont-reset', payload, 45_000);
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
  // FTTH — Carril bootstrap TR-069 (ZTP): mgmt WAN DHCP + Option 43
  // ────────────────────────────────────────────────────────────
  async ftthBootstrapTr069(payload: PythonFtthBootstrapRequest): Promise<PythonFtthBootstrapResponse> {
    this.logger.log(
      `→ Python ftth/bootstrap-tr069 | OLT=${payload.connection.ip} ` +
      `slot=${payload.slot} port=${payload.port} onu_id=${payload.onu_id} mgmt_vlan=${payload.mgmt_vlan}`,
    );
    const res = await this.post<PythonFtthBootstrapResponse>(
      '/api/v1/olt/ftth/bootstrap-tr069', payload, 60_000,
    );
    this.logger.log(`← ftth/bootstrap-tr069 | success=${res.success}`);
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
  // FTTH — listar ONT-IDs configurados en un puerto (incl. SmartOLT)
  // ────────────────────────────────────────────────────────────
  async ftthOntIds(payload: PythonFtthOntIdsRequest): Promise<number[]> {
    try {
      const res = await this.post<PythonFtthOntIdsResponse>(
        '/api/v1/olt/ftth/ont-ids', payload, 40_000,
      );
      return res.ont_ids ?? [];
    } catch (err: any) {
      // No bloquear el aprovisionamiento si la consulta falla — el auto-sanado
      // de colisión queda como red de seguridad.
      this.logger.warn(`← ftth/ont-ids falló (se continúa): ${err.message}`);
      return [];
    }
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
  // FTTH — verificar WAN PPPoE viva (watcher de re-inyección post factory-reset)
  // ────────────────────────────────────────────────────────────
  async ftthCheckWan(payload: PythonFtthCheckWanRequest): Promise<PythonFtthCheckWanResponse> {
    try {
      return await this.post<PythonFtthCheckWanResponse>(
        '/api/v1/olt/ftth/check-wan', payload, 20_000,
      );
    } catch (err: any) {
      this.logger.warn(`← ftth/check-wan falló (se trata como no verificado): ${err.message}`);
      return { ok: false, connected: false, username: null, error: err.message };
    }
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
      `sp=${payload.service_port_id} down=${payload.traffic_index_down} up=${payload.traffic_index_up}`,
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
  // Config real SNMP/NTP (POST /api/v1/olt/config/snmp-ntp)
  // Solo lectura. best-effort — el llamador decide qué hacer si falla.
  // ────────────────────────────────────────────────────────────
  async configSnmpNtp(payload: PythonSnmpNtpConfigRequest): Promise<PythonSnmpNtpConfigResponse> {
    this.logger.log(`→ Python config/snmp-ntp | OLT=${payload.connection.ip}`);
    const res = await this.post<PythonSnmpNtpConfigResponse>(
      '/api/v1/olt/config/snmp-ntp', payload, 100_000,
    );
    this.logger.log(
      `← Python config/snmp-ntp | success=${res.success} communities=${res.snmp_communities?.length ?? 0} ntp=${res.ntp_servers?.length ?? 0}`,
    );
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Aplicar servidores NTP (Incremento 5 — convergencia real)
  // ────────────────────────────────────────────────────────────
  async applyNtpServers(payload: PythonApplyNtpServersRequest): Promise<PythonApplyNtpServersResponse> {
    this.logger.log(`→ Python config/ntp/apply | OLT=${payload.connection.ip} servers=${payload.servers.join(',')}`);
    const res = await this.post<PythonApplyNtpServersResponse>(
      '/api/v1/olt/config/ntp/apply', payload, 60_000,
    );
    this.logger.log(`← Python config/ntp/apply | success=${res.success} ntp=${res.ntp_servers?.length ?? 0}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Service-ports reales (Incremento 6 — reconciliación de pools)
  // ────────────────────────────────────────────────────────────
  async servicePorts(payload: PythonServicePortsRequest): Promise<PythonServicePortsResponse> {
    this.logger.log(`→ Python config/service-ports | OLT=${payload.connection.ip}`);
    const res = await this.post<PythonServicePortsResponse>(
      '/api/v1/olt/config/service-ports', payload, 90_000,
    );
    this.logger.log(`← Python config/service-ports | success=${res.success} ports=${res.ports?.length ?? 0}`);
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
  // 90s: la sesión Paramiko interna usa 60s y el mutex por-IP puede encolar
  // detrás de un health-poll — 30s resultó insuficiente en producción
  // (timeout reproducido al aplicar el primer plan de baseline, 2026-07-14).
  async vlanAdd(payload: PythonVlanAddRequest): Promise<PythonVlanAddResponse> {
    this.logger.log(`→ Python vlan/add | OLT=${payload.connection.ip} vlan_id=${payload.vlan_id}`);
    const res = await this.post<PythonVlanAddResponse>('/api/v1/olt/vlan/add', payload, 90_000);
    this.logger.log(`← Python vlan/add | success=${res.success}`);
    return res;
  }

  async vlanDelete(payload: PythonVlanDeleteRequest): Promise<PythonVlanDeleteResponse> {
    this.logger.log(`→ Python vlan/delete | OLT=${payload.connection.ip} vlan_id=${payload.vlan_id}`);
    const res = await this.post<PythonVlanDeleteResponse>('/api/v1/olt/vlan/delete', payload, 90_000);
    this.logger.log(`← Python vlan/delete | success=${res.success}`);
    return res;
  }

  // ── Versión / modelo real (display version) ─────────────────
  async versionInfo(payload: PythonVersionInfoRequest): Promise<PythonVersionInfoResponse> {
    this.logger.log(`→ Python version-info | OLT=${payload.connection.ip}`);
    const res = await this.post<PythonVersionInfoResponse>('/api/v1/olt/version-info', payload, 60_000);
    this.logger.log(`← Python version-info | success=${res.success} model=${res.model} fw=${res.firmware}`);
    return res;
  }

  // ── ONT service-profiles ("tipos de ONU") ───────────────────
  async srvProfileAdd(payload: PythonSrvProfileAddRequest): Promise<PythonSrvProfileAddResponse> {
    this.logger.log(`→ Python srvprofile/add | OLT=${payload.connection.ip} name=${payload.name}`);
    const res = await this.post<PythonSrvProfileAddResponse>('/api/v1/olt/srvprofile/add', payload, 90_000);
    this.logger.log(`← Python srvprofile/add | success=${res.success} id=${res.profile_id}`);
    return res;
  }

  async srvProfileDelete(payload: PythonSrvProfileDeleteRequest): Promise<PythonSrvProfileDeleteResponse> {
    this.logger.log(`→ Python srvprofile/delete | OLT=${payload.connection.ip} name=${payload.name}`);
    const res = await this.post<PythonSrvProfileDeleteResponse>('/api/v1/olt/srvprofile/delete', payload, 90_000);
    this.logger.log(`← Python srvprofile/delete | success=${res.success}`);
    return res;
  }

  // ── ONT line-profiles ───────────────────────────────────────
  async lineProfileAdd(payload: PythonLineProfileAddRequest): Promise<PythonLineProfileAddResponse> {
    this.logger.log(`→ Python lineprofile/add | OLT=${payload.connection.ip} name=${payload.name}`);
    const res = await this.post<PythonLineProfileAddResponse>('/api/v1/olt/lineprofile/add', payload, 150_000);
    this.logger.log(`← Python lineprofile/add | success=${res.success} id=${res.profile_id} dba=${res.dba_profile_id}`);
    return res;
  }

  async lineProfileDelete(payload: PythonLineProfileDeleteRequest): Promise<PythonLineProfileDeleteResponse> {
    this.logger.log(`→ Python lineprofile/delete | OLT=${payload.connection.ip} name=${payload.name}`);
    const res = await this.post<PythonLineProfileDeleteResponse>('/api/v1/olt/lineprofile/delete', payload, 120_000);
    this.logger.log(`← Python lineprofile/delete | success=${res.success} dbaEliminado=${res.dba_eliminado}`);
    return res;
  }

  // ── Uplink VLAN tagging (Incremento 9b) ─────────────────────
  async uplinkVlans(payload: PythonUplinkVlansRequest): Promise<PythonUplinkVlansResponse> {
    this.logger.log(`→ Python vlan/uplink-vlans | OLT=${payload.connection.ip} port=${payload.port_path}`);
    const res = await this.post<PythonUplinkVlansResponse>('/api/v1/olt/vlan/uplink-vlans', payload, 90_000);
    this.logger.log(`← Python vlan/uplink-vlans | success=${res.success} vlans=${res.vlan_ids?.length}`);
    return res;
  }

  async uplinkVlanTag(payload: PythonUplinkTagRequest): Promise<PythonUplinkTagResponse> {
    this.logger.log(`→ Python vlan/uplink-tag | OLT=${payload.connection.ip} vlan=${payload.vlan_id} port=${payload.port_path}`);
    const res = await this.post<PythonUplinkTagResponse>('/api/v1/olt/vlan/uplink-tag', payload, 120_000);
    this.logger.log(`← Python vlan/uplink-tag | success=${res.success}`);
    return res;
  }

  // ────────────────────────────────────────────────────────────
  // Traffic Table CLI (POST /api/v1/olt/traffic-table/*)
  // ────────────────────────────────────────────────────────────
  async trafficTableAdd(payload: PythonTrafficTableAddRequest): Promise<PythonTrafficTableAddResponse> {
    this.logger.log(`→ Python traffic-table/add | OLT=${payload.connection.ip} name=${payload.name}`);
    // 90s: add_traffic_table abre 2 sesiones Netmiko secuenciales (crear +
    // consultar índice asignado) — 30s resultó insuficiente en producción
    // bajo el mutex por-IP (NODO MALVINAS, 2026-07-14).
    const res = await this.post<PythonTrafficTableAddResponse>('/api/v1/olt/traffic-table/add', payload, 90_000);
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
  // Clasificación de estados de ONUs de un puerto
  // (POST /api/v1/olt/onus/classify)
  // Timeout 180s: info all + detalle de cada offline + autofind en 1-3 sesiones
  // ────────────────────────────────────────────────────────────
  async clasificarOnus(payload: PythonClassifyOnusRequest): Promise<PythonClassifyOnusResponse> {
    this.logger.log(
      `→ Python onus/classify | OLT=${payload.connection.ip} ${payload.slot}/${payload.port}`,
    );
    const res = await this.post<PythonClassifyOnusResponse>(
      '/api/v1/olt/onus/classify', payload, 180_000,
    );
    this.logger.log(
      `← Python onus/classify | success=${res.success} onus=${res.onus?.length ?? 0} autofind=${res.autofind?.length ?? 0}`,
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

  // Mutex por-OLT: serializa TODA operación SSH hacia una misma OLT a través de
  // todo el backend (crons de monitoreo/health/recovery + requests de usuario).
  // El MA5800 limita las sesiones SSH concurrentes por usuario ("Reenter times
  // have reached the upper limit"); sin esta serialización, varios crons que caen
  // en el mismo minuto abren sesiones simultáneas y saturan la tabla de sesiones
  // de la OLT, provocando fallos de auth en cascada.
  private readonly oltTails = new Map<string, Promise<void>>();

  private async withOltLock<T>(ip: string, fn: () => Promise<T>): Promise<T> {
    const prevTail = this.oltTails.get(ip) ?? Promise.resolve();
    let releaseGate!: () => void;
    const gate = new Promise<void>((res) => { releaseGate = res; });
    const newTail = prevTail.then(() => gate);
    this.oltTails.set(ip, newTail);
    await prevTail.catch(() => { /* el error del anterior no es nuestro */ });
    try {
      return await fn();
    } finally {
      releaseGate();
      if (this.oltTails.get(ip) === newTail) this.oltTails.delete(ip);
    }
  }

  private async post<T>(endpoint: string, body: unknown, timeoutMs?: number): Promise<T> {
    this.checkConfig();
    const ip = (body as { connection?: { ip?: string } })?.connection?.ip;
    const exec = async (): Promise<T> => {
      try {
        const cfg = timeoutMs ? { ...this.getConfig(), timeout: timeoutMs } : this.getConfig();
        const res = await firstValueFrom(
          this.http.post<T>(`${this.baseUrl}${endpoint}`, body, cfg),
        );
        return res.data;
      } catch (error) {
        this.handleHttpError(error, 'POST', endpoint);
      }
    };
    return ip ? this.withOltLock(ip, exec) : exec();
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
