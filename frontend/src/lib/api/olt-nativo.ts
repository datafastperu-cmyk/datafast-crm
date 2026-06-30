import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

// ─── Types ────────────────────────────────────────────────────

export interface OltDispositivo {
  id:                     string;
  empresaId:              string;
  nombre:                 string;
  descripcion?:           string;
  marca:                  'huawei' | 'zte' | 'vsol' | 'cdata';
  modelo?:                string;
  metodoConexion:         'smartolt_api' | 'nativo_ssh' | 'nativo_snmp';
  ipGestion:              string;
  puerto:                 number;
  usuarioAnclado:         string;
  slotsTotales:           number;
  puertosPorSlot:         number;
  vlanGestionDefecto?:    number | null;
  snmpCommunity?:         string;
  snmpVersion?:           number;
  routerId:               string;
  dispositivoMonitoreoId?: string | null;
  estado:                 'online' | 'offline' | 'mantenimiento' | 'desconocido';
  ultimoPing?:            string | null;
  totalPonPorts?:         number | null;
  onusActivas:            number;
  ubicacion?:             string;
  latitud?:               number | null;
  longitud?:              number | null;
  activo:                 boolean;
  createdAt?:             string;
  updatedAt?:             string;
}

export interface CreateOltDto {
  nombre:                 string;
  descripcion?:           string;
  marca:                  'huawei' | 'zte' | 'vsol' | 'cdata';
  modelo?:                string;
  metodoConexion:         'smartolt_api' | 'nativo_ssh' | 'nativo_snmp';
  ipGestion:              string;
  puerto?:                number;
  usuarioAnclado:         string;
  contrasena:             string;
  slotsTotales?:          number;
  puertosPorSlot?:        number;
  vlanGestionDefecto?:    number;
  snmpCommunity?:         string;
  snmpVersion?:           number;
  routerId:               string;
  dispositivoMonitoreoId?: string;
  ubicacion?:             string;
  latitud?:               number;
  longitud?:              number;
}

export interface UpdateOltDto extends Partial<CreateOltDto> {}

export interface AlarmInfo {
  level:   'warning' | 'critical' | 'error';
  message: string;
}

export interface MetricasOnuResult {
  status:           'online' | 'offline' | 'degraded';
  metricsAvailable: boolean;
  rxPowerDbm?:      number | null;
  txPowerDbm?:      number | null;
  temperatureC?:    number | null;
  alarm?:           AlarmInfo | null;
}

export interface ProvisionResult {
  success:        boolean;
  message:        string;
  oltIp:          string;
  onuSn:          string;
  metodoConexion: string;
  details?:       Record<string, unknown> | null;
}

export interface ProvisionarOnuDto {
  contratoId:     string;
  clienteId:      string;
  frame:          number;
  slot:           number;
  port:           number;
  onuId:          number;
  sn:             string;
  vlan:           number;
  vlanGestion:    number;
  profileSpeed:   string;
  servicePortId?: number;
  trafficIndex?:  number;
  onuType?:       string;
  onuMode?:       'bridge' | 'routing';
}

export interface OntFoundInfo {
  sn:   string;
  slot: number;
  port: number;
}

export interface DiscoverResult {
  success: boolean;
  total:   number;
  onus:    OntFoundInfo[];
}

// ─── Firmware types ───────────────────────────────────────────

export interface OnuActivaInfo {
  id:           string;
  serialNumber: string;
  onuId:        number;
  ponSlot:      number;
  ponPortNum:   number;
  estado:       string;
}

export interface FirmwareJobProgress {
  onu_id:  number;
  status:  'pending' | 'transferring' | 'success' | 'failed';
  message: string | null;
}

export interface FirmwareJobResult {
  historialId:       string;
  oltId:             string;
  oltNombre:         string;
  firmwareFilename:  string;
  firmwareSizeBytes: number;
  slot:              number;
  port:              number;
  onuIds:            number[];
  estado:            'pendiente' | 'transfiriendo' | 'exitoso' | 'parcial' | 'fallido';
  pythonJobId:       string | null;
  resultado:         FirmwareJobProgress[] | null;
  errorMsg:          string | null;
  createdAt:         string;
  updatedAt:         string;
}

export interface TestConexionOltResult {
  exitoso:    boolean;
  mensaje:    string;
  latenciaMs?: number;
}

// ─── Multi-proveedor ──────────────────────────────────────────

export type TipoProveedor   = 'nativo_ssh' | 'nativo_snmp' | 'smartolt' | 'adminolt';
export type CircuitEstado   = 'closed' | 'open' | 'half_open';
export type HealthEstado    = 'ok' | 'degraded' | 'down' | 'unknown';

export interface OltProveedorConfig {
  id:                string;
  empresaId:         string;
  oltId:             string;
  tipo:              TipoProveedor;
  prioridad:         number;
  activo:            boolean;
  circuitEstado:     CircuitEstado;
  circuitFallas:     number;
  circuitAbiertoHasta?: string | null;
  healthEstado:      HealthEstado;
  healthLatenciaMs?: number | null;
  ultimoHealth?:     string | null;
  createdAt:         string;
  updatedAt:         string;
}

export interface ProveedorResumen {
  oltId:          string;
  worstHealth:    HealthEstado;
  hasOpenCircuit: boolean;
  totalActivo:    number;
}

export interface UpsertProveedorDto {
  tipo:          TipoProveedor;
  prioridad?:    number;
  activo?:       boolean;
  // nativo_ssh / nativo_snmp
  ip?:           string;
  port?:         number;
  username?:     string;
  password?:     string;
  brand?:        string;
  // smartolt / adminolt
  baseUrl?:      string;
  apiKey?:       string;
  oltIdExterno?: string;
}

export interface ProveedorConOlt {
  id:               string;
  oltId:            string;
  oltNombre:        string;
  oltMarca:         string;
  tipo:             TipoProveedor;
  prioridad:        number;
  activo:           boolean;
  circuitEstado:    CircuitEstado;
  healthEstado:     HealthEstado;
  healthLatenciaMs: number | null;
  ultimoHealth:     string | null;
  tieneCredenciales: boolean;
  baseUrl:          string | null;
  oltIdExterno:     string | null;
}

export interface TestProveedorResult {
  exitoso:    boolean;
  mensaje:    string;
  latenciaMs: number;
}

export type SmartoltLookupTipo = 'perfiles' | 'vlans' | 'zonas' | 'odbs' | 'tipos-onu';

export interface CrearOltIntegracionDto {
  nombre:         string;
  descripcion?:   string;
  marca:          'huawei' | 'zte' | 'vsol' | 'cdata';
  modelo?:        string;
  ipGestion:      string;
  routerId:       string;
  slotsTotales?:  number;
  puertosPorSlot?: number;
  ubicacion?:     string;
  latitud?:       number;
  longitud?:      number;
  baseUrl:        string;
  apiKey:         string;
  oltIdExterno?:  string;
  prioridad?:     number;
}

export interface ValidarIpResult {
  disponible: boolean;
  oltNombre?: string;
  seccion?:   'nativo' | 'smartolt' | 'adminolt';
}

export interface OltConProveedorPrincipal {
  id:                 string;
  nombre:             string;
  descripcion:        string | null;
  marca:              string;
  modelo:             string | null;
  metodoConexion:     string;
  ipGestion:          string;
  puerto:             number;
  slotsTotales:       number;
  puertosPorSlot:     number;
  vlanGestionDefecto: number | null;
  estado:             string;
  ultimoPing:         string | null;
  onusActivas:        number;
  ubicacion:          string | null;
  latitud:            number | null;
  longitud:           number | null;
  activo:             boolean;
  createdAt:          string;
  updatedAt:          string;
  proveedorPrincipal: {
    id:               string;
    tipo:             string;
    prioridad:        number;
    healthEstado:     string;
    healthLatenciaMs: number | null;
    ultimoHealth:     string | null;
    circuitEstado:    string;
    activo:           boolean;
  } | null;
}

export interface SmartoltPerfil   { id: string | number; name: string; type: string; }
export interface SmartoltVlan     { id: string | number; vlanId: number; description: string; oltId: string | number | null; }
export interface SmartoltZona     { id: string | number; name: string; oltId: string | number | null; }
export interface SmartoltOdb      { id: string | number; name: string; oltId: string | number | null; zoneId: string | number | null; }
export interface SmartoltTipoOnu  { id: number; name: string; }

// ─── API ──────────────────────────────────────────────────────

// ─── FTTH tipos ───────────────────────────────────────────────

export type FtthOnuEstado =
  | 'pendiente' | 'gpon_registrado' | 'wan_inyectado' | 'activo'
  | 'fallido_gpon' | 'fallido_wan' | 'desaprovisionando'
  | 'timeout_online' | 'fallido_service_port' | 'suspendido';

export interface FtthOnuRegistro {
  id:             string;
  contratoId:     string;
  oltId:          string;
  frame:          number;
  slot:           number;
  port:           number;
  onuId:          number;
  sn:             string;
  servicePortId:  number | null;
  vlan:           number;
  lineprofileId:  number | null;
  srvprofileId:   number | null;
  estado:         FtthOnuEstado;
  intentosGpon:   number;
  intentosWan:    number;
  ultimoError:    string | null;
  createdAt:      string;
  updatedAt:      string;
}

export interface FtthProvisionDto {
  contratoId:     string;
  frame:          number;
  slot:           number;
  port:           number;
  onuId?:         number;   // Opcional — auto-asignado del pool de ONU IDs
  sn:             string;
  servicePortId?: number;   // Opcional — auto-asignado del pool si está configurado
  vlan:           number;
  lineprofileId:  number;
  srvprofileId:   number;
  description?:   string;
}

export interface OltPerfilesResult {
  lineprofiles:   Array<{ profile_id: number; name: string }>;
  srvprofiles:    Array<{ profile_id: number; name: string }>;
  traffic_tables?: Array<{ index: number; name: string; cir_kbps?: number; pir_kbps?: number }>;
}

export interface OltVlan {
  id:          string;
  oltId:       string;
  empresaId:   string;
  vlanId:      number;
  nombre:      string;
  descripcion: string | null;
  createdAt:   string;
  updatedAt:   string;
}

export interface OltTrafficTable {
  id:        string;
  oltId:     string;
  empresaId: string;
  trafficId: number;
  nombre:    string;
  cirKbps:   number | null;
  pirKbps:   number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FtthProvisionResult {
  estado:     FtthOnuEstado;
  registroId: string;
  mensaje:    string;
  error?:     string;
}

// ─── API ──────────────────────────────────────────────────────

export const oltNativoApi = {

  listar: async (): Promise<OltDispositivo[]> => {
    const res = await api.get<ApiRespuesta<OltDispositivo[]>>('/olt-nativo');
    return res.data.data ?? [];
  },

  crear: async (dto: CreateOltDto): Promise<OltDispositivo> => {
    const res = await api.post<ApiRespuesta<OltDispositivo>>('/olt-nativo', dto);
    return res.data.data;
  },

  actualizar: async (oltId: string, dto: UpdateOltDto): Promise<OltDispositivo> => {
    const res = await api.put<ApiRespuesta<OltDispositivo>>(`/olt-nativo/${oltId}`, dto);
    return res.data.data;
  },

  eliminar: async (oltId: string): Promise<void> => {
    await api.delete(`/olt-nativo/${oltId}`);
  },

  provisionar: async (oltId: string, dto: ProvisionarOnuDto): Promise<ProvisionResult> => {
    const res = await api.post<ApiRespuesta<ProvisionResult>>(`/olt-nativo/${oltId}/provision`, dto);
    return res.data.data;
  },

  discoverOnus: async (
    oltId: string,
    slot?: number,
    port?: number,
  ): Promise<DiscoverResult> => {
    const params: Record<string, number> = {};
    if (slot != null) params.slot = slot;
    if (port != null) params.port = port;
    const res = await api.get<ApiRespuesta<DiscoverResult>>(
      `/olt-nativo/${oltId}/discover-onus`,
      { params, timeout: 65_000 },
    );
    return res.data.data;
  },

  metricas: async (
    oltId: string,
    params: { slot: number; port: number; onuId: number; sn?: string },
  ): Promise<MetricasOnuResult> => {
    const res = await api.get<ApiRespuesta<MetricasOnuResult>>(
      `/olt-nativo/${oltId}/metrics`,
      { params },
    );
    return res.data.data;
  },

  // ── Firmware OMCI ──────────────────────────────────────────

  listarOnusActivas: async (
    oltId: string,
    slot?: number,
    port?: number,
  ): Promise<OnuActivaInfo[]> => {
    const res = await api.get<ApiRespuesta<OnuActivaInfo[]>>(
      `/olt-nativo/${oltId}/onus`,
      { params: { ...(slot != null && { slot }), ...(port != null && { port }) } },
    );
    return res.data.data ?? [];
  },

  iniciarFirmwareUpgrade: async (
    oltId: string,
    file:  File,
    slot:  number,
    port:  number,
    onuIds: number[],
  ): Promise<{ historialId: string; pythonJobId: string; message: string }> => {
    const form = new FormData();
    form.append('firmware', file);
    form.append('slot',     String(slot));
    form.append('port',     String(port));
    form.append('onuIds',   JSON.stringify(onuIds));
    const res = await api.post<ApiRespuesta<{ historialId: string; pythonJobId: string; message: string }>>(
      `/olt-nativo/${oltId}/firmware/iniciar`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  getFirmwareJobStatus: async (
    oltId:       string,
    historialId: string,
  ): Promise<FirmwareJobResult> => {
    const res = await api.get<ApiRespuesta<FirmwareJobResult>>(
      `/olt-nativo/${oltId}/firmware/job/${historialId}`,
    );
    return res.data.data;
  },

  historialFirmware: async (
    oltId: string,
    limit = 10,
  ): Promise<FirmwareJobResult[]> => {
    const res = await api.get<ApiRespuesta<FirmwareJobResult[]>>(
      `/olt-nativo/${oltId}/firmware/historial`,
      { params: { limit } },
    );
    return res.data.data ?? [];
  },

  verificarOnu: async (
    oltId: string,
    params: { slot: number; port: number; onuId: number },
  ): Promise<{
    exitoso: boolean;
    runState: string | null;
    rxPowerDbm: number | null;
    txPowerDbm: number | null;
    error: string | null;
  }> => {
    const res = await api.get(
      `/olt-nativo/${oltId}/verify-onu`,
      { params: { slot: params.slot, port: params.port, onuId: params.onuId } },
    );
    return res.data.data;
  },

  testConexion: async (oltId: string): Promise<TestConexionOltResult> => {
    const res = await api.post<ApiRespuesta<TestConexionOltResult>>(`/olt-nativo/${oltId}/test-conexion`);
    return res.data.data;
  },

  testConexionDirecta: async (params: {
    ip: string; puerto: number; usuario: string; password: string; marca: string; oltId?: string;
  }): Promise<TestConexionOltResult> => {
    const res = await api.post<ApiRespuesta<TestConexionOltResult>>('/olt-nativo/test-conexion-directa', params);
    return res.data.data;
  },

  // ── Multi-proveedor ──────────────────────────────────────────

  listarProveedores: async (oltId: string): Promise<OltProveedorConfig[]> => {
    const res = await api.get<ApiRespuesta<OltProveedorConfig[]>>(`/olt-nativo/${oltId}/proveedores`);
    return res.data.data ?? [];
  },

  upsertProveedor: async (oltId: string, dto: UpsertProveedorDto): Promise<OltProveedorConfig> => {
    const res = await api.post<ApiRespuesta<OltProveedorConfig>>(`/olt-nativo/${oltId}/proveedores`, dto);
    return res.data.data;
  },

  resetCircuit: async (configId: string): Promise<void> => {
    await api.post(`/olt-nativo/proveedores/${configId}/reset-circuit`);
  },

  resumenProveedores: async (): Promise<ProveedorResumen[]> => {
    const res = await api.get<ApiRespuesta<ProveedorResumen[]>>('/olt-nativo/proveedores/resumen');
    return res.data.data ?? [];
  },

  listarPorTipo: async (tipo: TipoProveedor): Promise<ProveedorConOlt[]> => {
    const res = await api.get<ApiRespuesta<ProveedorConOlt[]>>(
      '/olt-nativo/proveedores/por-tipo',
      { params: { tipo } },
    );
    return res.data.data ?? [];
  },

  testProveedor: async (configId: string): Promise<TestProveedorResult> => {
    const res = await api.post<ApiRespuesta<TestProveedorResult>>(
      `/olt-nativo/proveedores/${configId}/test`,
    );
    return res.data.data;
  },

  smartoltLookup: async <T = unknown>(
    configId: string,
    tipo:     SmartoltLookupTipo,
  ): Promise<T[]> => {
    const res = await api.get<ApiRespuesta<T[]>>(
      `/olt-nativo/smartolt/${configId}/lookup`,
      { params: { tipo } },
    );
    return res.data.data ?? [];
  },

  // ── FTTH ──────────────────────────────────────────────────

  ftthProvision: async (oltId: string, dto: FtthProvisionDto): Promise<FtthProvisionResult> => {
    const res = await api.post<ApiRespuesta<FtthProvisionResult>>(
      `/olt-nativo/${oltId}/ftth/provision`, dto, { timeout: 200_000 },
    );
    return res.data.data;
  },

  ftthReinjectWan: async (oltId: string, contratoId: string): Promise<FtthProvisionResult> => {
    const res = await api.post<ApiRespuesta<FtthProvisionResult>>(
      `/olt-nativo/${oltId}/ftth/reinject-wan`, { contratoId },
    );
    return res.data.data;
  },

  ftthDesaprovisionar: async (
    oltId: string,
    contratoId: string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> => {
    const res = await api.post<ApiRespuesta<{ exitoso: boolean; mensaje: string; error?: string }>>(
      `/olt-nativo/${oltId}/ftth/desaprovisionar`, { contratoId },
    );
    return res.data.data;
  },

  listarPerfiles: async (oltId: string): Promise<OltPerfilesResult> => {
    const res = await api.get<ApiRespuesta<OltPerfilesResult>>(
      `/olt-nativo/${oltId}/profiles`,
      { timeout: 30_000 },
    );
    return res.data.data;
  },

  ftthEstado: async (contratoId: string): Promise<FtthOnuRegistro | null> => {
    try {
      const res = await api.get<ApiRespuesta<FtthOnuRegistro | null>>(
        `/olt-nativo/ftth/estado/${contratoId}`,
      );
      return res.data.data ?? null;
    } catch {
      return null;
    }
  },

  validarIp: async (ip: string): Promise<ValidarIpResult> => {
    const res = await api.get<ApiRespuesta<ValidarIpResult>>(
      '/olt-nativo/validar-ip',
      { params: { ip } },
    );
    return res.data.data;
  },

  listarTodas: async (): Promise<OltConProveedorPrincipal[]> => {
    const res = await api.get<ApiRespuesta<OltConProveedorPrincipal[]>>('/olt-nativo/todas');
    return res.data.data ?? [];
  },

  crearSmartolt: async (dto: CrearOltIntegracionDto): Promise<OltDispositivo> => {
    const res = await api.post<ApiRespuesta<OltDispositivo>>('/olt-nativo/integraciones/smartolt', dto);
    return res.data.data;
  },

  crearAdminolt: async (dto: CrearOltIntegracionDto): Promise<OltDispositivo> => {
    const res = await api.post<ApiRespuesta<OltDispositivo>>('/olt-nativo/integraciones/adminolt', dto);
    return res.data.data;
  },

  // ─── VLANs ───────────────────────────────────────────────────

  ftthCambiarVelocidad: async (
    oltId: string,
    contratoId: string,
    trafficIndex: number,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> => {
    const res = await api.post<ApiRespuesta<{ exitoso: boolean; mensaje: string; error?: string }>>(
      `/olt-nativo/${oltId}/ftth/cambiar-velocidad`,
      { contratoId, trafficIndex },
    );
    return res.data.data;
  },

  ftthSuspender: async (
    oltId: string,
    contratoId: string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> => {
    const res = await api.post<ApiRespuesta<{ exitoso: boolean; mensaje: string; error?: string }>>(
      `/olt-nativo/${oltId}/ftth/suspender`,
      { contratoId },
    );
    return res.data.data;
  },

  ftthRehabilirar: async (
    oltId: string,
    contratoId: string,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> => {
    const res = await api.post<ApiRespuesta<{ exitoso: boolean; mensaje: string; error?: string }>>(
      `/olt-nativo/${oltId}/ftth/rehabilitar`,
      { contratoId },
    );
    return res.data.data;
  },

  // ─── VLANs ───────────────────────────────────────────────────

  listarVlans: async (oltId: string): Promise<OltVlan[]> => {
    const res = await api.get<ApiRespuesta<OltVlan[]>>(`/olt-nativo/${oltId}/vlans`);
    return res.data.data ?? [];
  },

  agregarVlan: async (
    oltId: string,
    dto: { vlanId: number; nombre: string; descripcion?: string },
  ): Promise<OltVlan> => {
    const res = await api.post<ApiRespuesta<OltVlan>>(`/olt-nativo/${oltId}/vlans`, dto);
    return res.data.data;
  },

  eliminarVlan: async (oltId: string, vlanId: number): Promise<void> => {
    await api.delete(`/olt-nativo/${oltId}/vlans/${vlanId}`);
  },

  // ─── Traffic Tables ───────────────────────────────────────────

  listarTrafficTables: async (oltId: string): Promise<OltTrafficTable[]> => {
    const res = await api.get<ApiRespuesta<OltTrafficTable[]>>(`/olt-nativo/${oltId}/traffic-tables`);
    return res.data.data ?? [];
  },

  ftthSignalDashboard: async (oltId: string): Promise<Array<{
    registro: FtthOnuRegistro;
    signal: {
      run_state: string;
      rx_power_dbm: number | null;
      tx_power_dbm: number | null;
      temperature_c: number | null;
    } | null;
  }>> => {
    const res = await api.get<ApiRespuesta<any[]>>(`/olt-nativo/${oltId}/ftth/signal-dashboard`);
    return res.data.data ?? [];
  },

  sincronizarTrafficTables: async (oltId: string): Promise<{ insertadas: number; actualizadas: number }> => {
    const res = await api.post<ApiRespuesta<{ insertadas: number; actualizadas: number }>>(
      `/olt-nativo/${oltId}/traffic-tables/sincronizar`,
    );
    return res.data.data;
  },

  wizardInicializarOlt: async (oltId: string): Promise<{
    lineprofiles:  Array<{ profile_id: number; name: string }>;
    srvprofiles:   Array<{ profile_id: number; name: string }>;
    trafficTables: { insertadas: number; actualizadas: number };
    total:         number;
  }> => {
    const res = await api.post<ApiRespuesta<{
      lineprofiles:  Array<{ profile_id: number; name: string }>;
      srvprofiles:   Array<{ profile_id: number; name: string }>;
      trafficTables: { insertadas: number; actualizadas: number };
      total:         number;
    }>>(`/olt-nativo/${oltId}/wizard/inicializar`, {}, { timeout: 60_000 });
    return res.data.data;
  },

  ftthReconciliar: async (oltId: string): Promise<{
    enErpNoEnOlt: FtthOnuRegistro[];
    enOltNoEnErp: Array<{ sn: string; slot: number; port: number; ont_model?: string }>;
    sincronizados: number;
  }> => {
    const res = await api.get<ApiRespuesta<{
      enErpNoEnOlt: FtthOnuRegistro[];
      enOltNoEnErp: Array<{ sn: string; slot: number; port: number; ont_model?: string }>;
      sincronizados: number;
    }>>(`/olt-nativo/${oltId}/ftth/reconciliar`, { timeout: 60_000 });
    return res.data.data;
  },
};
