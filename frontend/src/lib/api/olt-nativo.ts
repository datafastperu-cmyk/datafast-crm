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
  baselineId?:            string | null;
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

// ─── Tipos nuevos: Detalle OLT (Etapa 1) ─────────────────────

export interface OltBoard {
  id:           string;
  oltId:        string;
  slot:         number;
  boardType:    string;
  estado:       string;
  onuCount:     number;
  portsPorSlot: number | null;
  createdAt:    string;
  updatedAt:    string;
}

export interface OltLineProfile {
  id:        string;
  oltId:     string;
  profileId: number;
  nombre:    string;
}

export interface OltServiceProfile {
  id:        string;
  oltId:     string;
  profileId: number;
  nombre:    string;
}

export interface OltSyncJob {
  id:           string;
  oltId:        string;
  estado:       'pending' | 'running' | 'completed' | 'failed';
  progreso:     number;
  resultado:    Record<string, unknown>;
  error:        string | null;
  iniciadoEn:   string;
  completadoEn: string | null;
}

export interface OltEventoLog {
  id:                    string;
  onuSn:                 string | null;
  tipo:                  string;
  estado:                string;
  proveedorExitoso:      string | null;
  proveedoresIntentados: string[];
  errorMensaje:          string | null;
  duracionMs:            number | null;
  usuarioId:             string | null;
  createdAt:             string;
}

export interface FtthRegistro {
  id:              string;
  oltId:           string;
  contratoId:      string;
  sn:              string;
  slot:            number;
  port:            number;
  onuId:           number;
  vlan:            number;
  estado:          string;
  runState:        string | null;
  firmwareVersion: string | null;
  uptimeSeconds:   number | null;
  createdAt:       string;
  updatedAt:       string;
}

export interface PaginatedResult<T> {
  data:  T[];
  total: number;
}

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

// ─── Wizard agregar OLT nativa SSH ───────────────────────────

export interface WizardBoardInfo {
  slot:         number;
  board_type:   string;
  state:        string;
  onu_count:    number;
  onu_capacity: number;
  online_onus:  number;
  offline_onus: number;
}

export interface WizardVlanInfo {
  vlan_id: number;
  name:    string;
}

export interface WizardTrafficTableInfo {
  index:     number;
  name:      string;
  cir_kbps:  number | null;
  pir_kbps:  number | null;
}

export interface WizardProfileInfo {
  profile_id: number;
  name:       string;
}

export interface WizardTopologyResponse {
  success:          boolean;
  model:            string | null;
  firmware_version: string | null;
  boards:           WizardBoardInfo[];
  vlans:            WizardVlanInfo[];
  traffic_tables:   WizardTrafficTableInfo[];
  line_profiles:    WizardProfileInfo[];
  service_profiles: WizardProfileInfo[];
  error?:           string;
}

export interface WizardCommitPayload {
  nombre:         string;
  ipGestion:      string;
  puerto:         number;
  usuario:        string;
  contrasena:     string;
  marca:          string;
  modelo:         string;
  firmware?:      string;
  zonaId?:        string;
  ubicacion?:     string;
  latitud?:       number;
  longitud?:      number;
  descripcion?:   string;
  escenario?:     'greenfield' | 'brownfield';
  baselineId?:    string;
  vlans?:         Array<{ vlan_id: number; nombre: string }>;
  trafficTables?: Array<{ index: number; name: string; cir_kbps?: number; pir_kbps?: number }>;
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

export interface OnuClasificada {
  onuId:           number | null;
  sn:              string | null;
  estadoOperativo: 'online' | 'apagada' | 'ruptura_fibra' | 'desactivada' | 'offline' | 'no_aprovisionada';
  controlFlag:     string | null;
  runState:        string | null;
  configState:     string | null;
  downCause:       string | null;
  dyingGaspTime:   string | null;
  rxPowerDbm:      number | null;
  txPowerDbm:      number | null;
  sinContrato:     boolean;
  contratoId:      string | null;
  numeroContrato:  string | null;
  cliente:         string | null;
}

export interface ClasificarOnusResult {
  success: boolean;
  slot:    number;
  port:    number;
  onus:    OnuClasificada[];
  error?:  string;
}

export interface OnuInventarioItem {
  slot:            number;
  port:            number;
  onuId:           number | null;
  sn:              string;
  estadoOperativo: OnuClasificada['estadoOperativo'];
  controlFlag:     string | null;
  runState:        string | null;
  rxPowerDbm:      number | null;
  sinContrato:     boolean;
  contratoId:      string | null;
  numeroContrato:  string | null;
  cliente:         string | null;
  origen:          'configurada' | 'autofind';
  snapshotAt:      string;
}

export interface InventarioResult {
  onus:  OnuInventarioItem[];
  drift: {
    onusInventario?:       number;
    onusSinContrato?:      number;
    onusNoAprovisionadas?: number;
    onusEnErpNoEnOlt?:     number;
    [k: string]: unknown;
  } | null;
  snapshotAt: string | null;
}

export interface OnuInventarioGlobalItem {
  oltId:           string;
  oltNombre:       string;
  slot:            number;
  port:            number;
  onuId:           number | null;
  sn:              string;
  estadoOperativo: OnuClasificada['estadoOperativo'];
  rxPowerDbm:      number | null;
  sinContrato:     boolean;
  contratoId:      string | null;
  numeroContrato:  string | null;
  cliente:         string | null;
  origen:          'configurada' | 'autofind';
  snapshotAt:      string;
}

export interface DriftResult {
  enErpNoEnOlt: Array<{
    contratoId: string; sn: string; slot: number; port: number;
    numeroContrato: string | null; cliente: string | null;
  }>;
  sinContrato: Array<{
    sn: string; slot: number; port: number; onuId: number | null;
    estadoOperativo: string; rxPowerDbm: number | null;
  }>;
  noAprovisionadas: Array<{ sn: string; slot: number; port: number }>;
  snapshotAt: string | null;
}

export interface ComplianceCheck {
  regla:     string;
  cumple:    boolean;
  severidad: 'info' | 'warning' | 'critical';
  mensaje:   string;
}

export interface ComplianceReport {
  oltId:        string;
  oltNombre:    string;
  evaluadoEn:   string;
  checks:       ComplianceCheck[];
  cumpleTodo:   boolean;
  criticos:     number;
  advertencias: number;
}

// ── Baselines declarativos (Incrementos 8-9) ─────────────────
export interface BaselineSpec {
  vlans:         Array<{ vlanId: number; nombre: string; proposito?: string; uplink?: boolean }>;
  trafficTables: Array<{ nombre: string; cirKbps: number; pirKbps: number }>;
  ntpServers?:   string[];
  uplinkPort?:   string;   // frame/slot/port, ej. '0/9/0'
}

export interface OltBaselineItem {
  id:          string;
  nombre:      string;
  version:     number;
  descripcion: string | null;
  spec:        BaselineSpec;
  activo:      boolean;
  createdAt:   string;
}

export interface BaselinePlanOperacion {
  orden:   number;
  tipo:    'crear_vlan' | 'crear_traffic_table';
  detalle: string;
  params:  Record<string, unknown>;
}

export interface BaselinePlan {
  oltId:           string;
  baselineId:      string;
  baselineNombre:  string;
  baselineVersion: number;
  generadoEn:      string;
  operaciones:     BaselinePlanOperacion[];
  bloqueos:        Array<{ recurso: string; motivo: string }>;
  planHash:        string;
  yaConverge:      boolean;
}

export interface BaselineAplicacionResultado {
  oltId:      string;
  planHash:   string;
  ejecutadas: number;
  fallidas:   number;
  resultados: Array<BaselinePlanOperacion & { exitoso: boolean; mensaje: string }>;
  completado: boolean;
}

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
  trafficIndexDown: number | null;
  trafficIndexUp:   number | null;
  lineprofileId:  number | null;
  srvprofileId:   number | null;
  wanMode?:       'bridge' | 'routing';
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
  onuId?:         number;
  sn:             string;
  servicePortId?: number;
  vlan:           number;
  lineprofileId:  number;
  srvprofileId:   number;
  trafficIndexDown?: number;  // outbound bajada; undefined = índice 0 sin límite
  trafficIndexUp?:   number;  // inbound subida;  undefined = índice 0 sin límite
  description?:      string;
  wanMode?:          'bridge' | 'routing';  // bridge = PPPoE en router cliente (default)
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
  origen:      'erp' | 'olt';
  estado:      'active' | 'syncing' | 'error';
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
  cbsBytes:  number | null;
  pbsBytes:  number | null;
  tipo:      'upstream' | 'downstream' | 'combinado';
  origen:    'erp' | 'olt';
  estado:    'active' | 'syncing' | 'error';
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

  findOne: async (oltId: string): Promise<OltDispositivo> => {
    const res = await api.get<ApiRespuesta<OltDispositivo>>(`/olt-nativo/${oltId}`);
    return res.data.data;
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

  ftthResetOnu: async (oltId: string, slot: number, port: number, onuId: number): Promise<{ exitoso?: boolean; mensaje?: string }> => {
    const res = await api.post<ApiRespuesta<{ exitoso?: boolean; mensaje?: string }>>(
      `/olt-nativo/${oltId}/ont-reset`, {}, { params: { slot, port, onuId }, timeout: 60_000 },
    );
    return res.data.data;
  },

  ftthActualizarWan: async (contratoId: string): Promise<{ actualizado: boolean; mensaje: string; error?: string; skipped?: boolean }> => {
    const res = await api.post<ApiRespuesta<{ actualizado: boolean; mensaje: string; error?: string; skipped?: boolean }>>(
      `/olt-nativo/ftth/actualizar-wan/${contratoId}`, {}, { timeout: 120_000 },
    );
    return res.data.data;
  },

  ftthCancelar: async (contratoId: string): Promise<{ cancelado: boolean; mensaje: string }> => {
    const res = await api.post<ApiRespuesta<{ cancelado: boolean; mensaje: string }>>(
      `/olt-nativo/ftth/cancelar/${contratoId}`, {}, { timeout: 60_000 },
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
    trafficIndexDown: number,
    trafficIndexUp: number,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> => {
    const res = await api.post<ApiRespuesta<{ exitoso: boolean; mensaje: string; error?: string }>>(
      `/olt-nativo/${oltId}/ftth/cambiar-velocidad`,
      { contratoId, trafficIndexDown, trafficIndexUp },
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

  agregarVlanConCli: async (
    oltId: string,
    dto: { vlanId: number; nombre: string; descripcion?: string },
  ): Promise<OltVlan> => {
    const res = await api.post<ApiRespuesta<OltVlan>>(
      `/olt-nativo/${oltId}/vlans/con-cli`, dto, { timeout: 60_000 },
    );
    return res.data.data;
  },

  eliminarVlanConCli: async (oltId: string, vlanId: number): Promise<void> => {
    await api.delete(`/olt-nativo/${oltId}/vlans/${vlanId}/con-cli`, { timeout: 60_000 });
  },

  editarVlanNombre: async (oltId: string, vlanId: number, nombre: string): Promise<OltVlan> => {
    const res = await api.patch<ApiRespuesta<OltVlan>>(
      `/olt-nativo/${oltId}/vlans/${vlanId}`, { nombre },
    );
    return res.data.data;
  },

  pullVlansDesdeOlt: async (oltId: string): Promise<{ insertadas: number; omitidas: number }> => {
    const res = await api.post<ApiRespuesta<{ insertadas: number; omitidas: number }>>(
      `/olt-nativo/${oltId}/vlans/pull-desde-olt`, {}, { timeout: 60_000 },
    );
    return res.data.data;
  },

  // ─── Traffic Tables ───────────────────────────────────────────

  listarTrafficTables: async (oltId: string): Promise<OltTrafficTable[]> => {
    const res = await api.get<ApiRespuesta<OltTrafficTable[]>>(`/olt-nativo/${oltId}/traffic-tables`);
    return res.data.data ?? [];
  },

  agregarTrafficTable: async (
    oltId: string,
    dto: { nombre: string; cirKbps: number; pirKbps: number; tipo?: string; cbsBytes?: number | null; pbsBytes?: number | null },
  ): Promise<OltTrafficTable> => {
    const res = await api.post<ApiRespuesta<OltTrafficTable>>(
      `/olt-nativo/${oltId}/traffic-tables`, dto, { timeout: 60_000 },
    );
    return res.data.data;
  },

  editarTrafficTable: async (
    oltId: string,
    trafficId: number,
    dto: { nombre: string; cirKbps: number; pirKbps: number; tipo?: string; cbsBytes?: number | null; pbsBytes?: number | null },
  ): Promise<OltTrafficTable> => {
    const res = await api.patch<ApiRespuesta<OltTrafficTable>>(
      `/olt-nativo/${oltId}/traffic-tables/${trafficId}`, dto, { timeout: 60_000 },
    );
    return res.data.data;
  },

  eliminarTrafficTableConCli: async (oltId: string, trafficId: number): Promise<void> => {
    await api.delete(`/olt-nativo/${oltId}/traffic-tables/${trafficId}/con-cli`, { timeout: 60_000 });
  },

  // ── Service Port ID pool ──────────────────────────────────────
  servicePortPoolEstado: async (oltId: string): Promise<{
    total: number; libres: number; ocupados: number; rango?: { min: number; max: number };
  }> => {
    const res = await api.get<ApiRespuesta<{ total: number; libres: number; ocupados: number; rango?: { min: number; max: number } }>>(
      `/olt-nativo/${oltId}/service-port-pool`,
    );
    return res.data.data;
  },

  configurarServicePortPool: async (oltId: string, dto: { inicio: number; fin: number }): Promise<{ creados: number }> => {
    const res = await api.post<ApiRespuesta<{ creados: number }>>(
      `/olt-nativo/${oltId}/service-port-pool/configurar`, dto,
    );
    return res.data.data;
  },

  limpiarServicePortPoolLibres: async (oltId: string): Promise<{ eliminados: number }> => {
    const res = await api.delete<ApiRespuesta<{ eliminados: number }>>(
      `/olt-nativo/${oltId}/service-port-pool/libres`,
    );
    return res.data.data;
  },

  ftthSignalDashboard: async (oltId: string): Promise<Array<{
    registro:      FtthOnuRegistro;
    signal: {
      run_state:     string;
      rx_power_dbm:  number | null;
      tx_power_dbm:  number | null;
      temperature_c: number | null;
    } | null;
    clienteNombre: string | null;
    planNombre:    string | null;
  }>> => {
    const res = await api.get<ApiRespuesta<any[]>>(`/olt-nativo/${oltId}/ftth/signal-dashboard`);
    return res.data.data ?? [];
  },

  sincronizarTrafficTables: async (oltId: string): Promise<{ insertadas: number; actualizadas: number }> => {
    const res = await api.post<ApiRespuesta<{ insertadas: number; actualizadas: number }>>(
      `/olt-nativo/${oltId}/traffic-tables/sincronizar`, undefined, { timeout: 120_000 },
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

  // ── Wizard agregar OLT nativa SSH ──────────────────────────────

  // ── Health dashboard ───────────────────────────────────────
  healthBoards: async (oltId: string): Promise<Array<{
    slot: number; boardType: string | null; boardState: string | null;
    onuCapacity: number | null; onusOnline: number | null;
    onusOffline: number | null; onusTotal: number | null;
    capturedAt: string;
  }>> => {
    const res = await api.get<ApiRespuesta<any[]>>(`/olt-nativo/${oltId}/health/boards`);
    return res.data.data ?? [];
  },

  healthPom: async (oltId: string): Promise<Array<{
    slot: number; port: number;
    tempCelsius: number | null; txDbm: number | null; rxDbm: number | null;
    voltageMv: number | null; laserMa: number | null;
    pomState: string | null; capturedAt: string;
  }>> => {
    const res = await api.get<ApiRespuesta<any[]>>(`/olt-nativo/${oltId}/health/pom`);
    return res.data.data ?? [];
  },

  healthPonPorts: async (oltId: string, slot?: number): Promise<Array<{
    slot: number; port: number;
    portType: string | null; adminState: string | null;
    operState: string | null; autofind: string | null;
    onusOnline: number | null; onusOffline: number | null;
    onusTotal: number | null; onuCapacity: number | null;
    capturedAt: string;
  }>> => {
    const params = slot !== undefined ? { slot } : {};
    const res = await api.get<ApiRespuesta<any[]>>(
      `/olt-nativo/${oltId}/health/pon-ports`, { params },
    );
    return res.data.data ?? [];
  },

  wizardTopologia: async (params: {
    ip: string; puerto: number; usuario: string; contrasena: string; marca: string;
  }): Promise<WizardTopologyResponse> => {
    const res = await api.post<ApiRespuesta<WizardTopologyResponse>>(
      '/olt-nativo/wizard/topology', params, { timeout: 60_000 },
    );
    return res.data.data;
  },

  wizardCommit: async (dto: WizardCommitPayload): Promise<{
    oltId: string;
    vlans?: { insertadas: number; omitidas: number };
    trafficTables?: { insertadas: number; actualizadas: number };
  }> => {
    const res = await api.post<ApiRespuesta<{
      oltId: string;
      vlans?: { insertadas: number; omitidas: number };
      trafficTables?: { insertadas: number; actualizadas: number };
    }>>('/olt-nativo/wizard/commit', dto, { timeout: 60_000 });
    return res.data.data;
  },

  // ── Detalle OLT: nuevos endpoints (Etapa 1) ──────────────────

  patch: async (oltId: string, dto: Partial<CreateOltDto>): Promise<OltDispositivo> => {
    const res = await api.patch<ApiRespuesta<OltDispositivo>>(`/olt-nativo/${oltId}`, dto);
    return res.data.data;
  },

  getBoards: async (oltId: string): Promise<OltBoard[]> => {
    const res = await api.get<ApiRespuesta<OltBoard[]>>(`/olt-nativo/${oltId}/boards`);
    return res.data.data ?? [];
  },

  getLineProfiles: async (oltId: string): Promise<OltLineProfile[]> => {
    const res = await api.get<ApiRespuesta<OltLineProfile[]>>(`/olt-nativo/${oltId}/line-profiles`);
    return res.data.data ?? [];
  },

  getServiceProfiles: async (oltId: string): Promise<OltServiceProfile[]> => {
    const res = await api.get<ApiRespuesta<OltServiceProfile[]>>(`/olt-nativo/${oltId}/service-profiles`);
    return res.data.data ?? [];
  },

  getEventos: async (
    oltId: string, page = 1, limit = 20,
  ): Promise<PaginatedResult<OltEventoLog>> => {
    const res = await api.get<ApiRespuesta<PaginatedResult<OltEventoLog>>>(
      `/olt-nativo/${oltId}/eventos`, { params: { page, limit } },
    );
    return res.data.data ?? { data: [], total: 0 };
  },

  getFtthRegistros: async (
    oltId: string, page = 1, limit = 50,
  ): Promise<PaginatedResult<FtthRegistro>> => {
    const res = await api.get<ApiRespuesta<PaginatedResult<FtthRegistro>>>(
      `/olt-nativo/${oltId}/ftth-registros`, { params: { page, limit } },
    );
    return res.data.data ?? { data: [], total: 0 };
  },

  clasificarOnus: async (
    oltId: string, slot: number, port: number,
  ): Promise<ClasificarOnusResult> => {
    const res = await api.get<ApiRespuesta<ClasificarOnusResult>>(
      `/olt-nativo/${oltId}/onus`, { params: { slot, port }, timeout: 200_000 },
    );
    return res.data.data;
  },

  getInventario: async (oltId: string): Promise<InventarioResult> => {
    const res = await api.get<ApiRespuesta<InventarioResult>>(`/olt-nativo/${oltId}/inventario`);
    return res.data.data ?? { onus: [], drift: null, snapshotAt: null };
  },

  getInventarioGlobal: async (): Promise<OnuInventarioGlobalItem[]> => {
    const res = await api.get<ApiRespuesta<OnuInventarioGlobalItem[]>>('/olt-nativo/onus-inventario');
    return res.data.data ?? [];
  },

  getDrift: async (oltId: string): Promise<DriftResult> => {
    const res = await api.get<ApiRespuesta<DriftResult>>(`/olt-nativo/${oltId}/drift`);
    return res.data.data ?? { enErpNoEnOlt: [], sinContrato: [], noAprovisionadas: [], snapshotAt: null };
  },

  reaplicarDrift: async (oltId: string, contratoId: string): Promise<{ encolado: boolean }> => {
    const res = await api.post<ApiRespuesta<{ encolado: boolean }>>(
      `/olt-nativo/${oltId}/drift/reaplicar/${contratoId}`,
    );
    return res.data.data;
  },

  getCompliance: async (oltId: string): Promise<ComplianceReport> => {
    const res = await api.get<ApiRespuesta<ComplianceReport>>(`/olt-nativo/${oltId}/compliance`);
    return res.data.data;
  },

  aplicarNtpServers: async (oltId: string, servers: string[]): Promise<{
    aplicado: boolean; ntpServers: unknown; error?: string;
  }> => {
    const res = await api.put<ApiRespuesta<{ aplicado: boolean; ntpServers: unknown; error?: string }>>(
      `/olt-nativo/${oltId}/config/ntp`, { servers },
    );
    return res.data.data;
  },

  // ── Catálogo de modelos + detección de versión (wizard) ─────
  getCatalogoModelos: async (): Promise<Record<string, Array<{
    modelo: string; estado: 'validado' | 'experimental';
    firmwaresValidados: string[]; notas?: string;
  }>>> => {
    const res = await api.get<ApiRespuesta<Record<string, Array<{
      modelo: string; estado: 'validado' | 'experimental';
      firmwaresValidados: string[]; notas?: string;
    }>>>>('/olt-nativo/catalogo-modelos');
    return res.data.data ?? {};
  },

  wizardDetectVersion: async (params: {
    ip: string; puerto: number; usuario: string; contrasena: string; marca: string;
  }): Promise<{
    exitoso: boolean; modelo: string | null; firmware: string | null; patch: string | null;
    compatibilidad: { nivel: 'validado' | 'firmware_no_probado' | 'experimental' | 'no_soportado'; mensaje: string };
    error?: string;
  }> => {
    const res = await api.post<ApiRespuesta<{
      exitoso: boolean; modelo: string | null; firmware: string | null; patch: string | null;
      compatibilidad: { nivel: 'validado' | 'firmware_no_probado' | 'experimental' | 'no_soportado'; mensaje: string };
      error?: string;
    }>>('/olt-nativo/wizard/detect-version', params, { timeout: 90_000 });
    return res.data.data;
  },

  // ── Baselines declarativos (Incrementos 8-9) ────────────────
  getBaselines: async (): Promise<OltBaselineItem[]> => {
    const res = await api.get<ApiRespuesta<OltBaselineItem[]>>('/olt-nativo/baselines');
    return res.data.data ?? [];
  },

  crearBaseline: async (dto: {
    nombre: string; descripcion?: string;
    vlans: BaselineSpec['vlans']; trafficTables: BaselineSpec['trafficTables'];
    ntpServers?: string[]; uplinkPort?: string;
  }): Promise<OltBaselineItem> => {
    const res = await api.post<ApiRespuesta<OltBaselineItem>>('/olt-nativo/baselines', dto);
    return res.data.data;
  },

  asignarBaseline: async (oltId: string, baselineId: string | null): Promise<void> => {
    await api.patch(`/olt-nativo/${oltId}/baseline`, { baselineId });
  },

  getBaselinePlan: async (oltId: string): Promise<BaselinePlan> => {
    const res = await api.get<ApiRespuesta<BaselinePlan>>(`/olt-nativo/${oltId}/baseline/plan`);
    return res.data.data;
  },

  aplicarBaselinePlan: async (oltId: string, planHash: string): Promise<BaselineAplicacionResultado> => {
    const res = await api.post<ApiRespuesta<BaselineAplicacionResultado>>(
      `/olt-nativo/${oltId}/baseline/aplicar`, { planHash },
    );
    return res.data.data;
  },

  iniciarSync: async (oltId: string): Promise<{ jobId: string }> => {
    const res = await api.post<ApiRespuesta<{ jobId: string }>>(`/olt-nativo/${oltId}/sync`);
    return res.data.data;
  },

  getSyncStatus: async (oltId: string): Promise<OltSyncJob | null> => {
    const res = await api.get<ApiRespuesta<OltSyncJob | null>>(`/olt-nativo/${oltId}/sync/status`);
    return res.data.data ?? null;
  },

  // ── ONU: detalle LIVE por TR-069 (botón "Ver detalle" del inventario) ──
  onuTr069Detalle: async (sn: string): Promise<OnuTr069Detalle> => {
    const res = await api.get<ApiRespuesta<OnuTr069Detalle>>(`/olt-nativo/onu/${encodeURIComponent(sn)}/tr069`);
    return res.data.data;
  },
  onuTr069Refresh: async (sn: string): Promise<OnuTr069Detalle> => {
    const res = await api.post<ApiRespuesta<OnuTr069Detalle>>(
      `/olt-nativo/onu/${encodeURIComponent(sn)}/tr069/refresh`, {}, { timeout: 60_000 },
    );
    return res.data.data;
  },
  onuTr069Reboot: async (sn: string): Promise<{ ok: boolean; mensaje: string }> => {
    const res = await api.post<ApiRespuesta<{ ok: boolean; mensaje: string }>>(
      `/olt-nativo/onu/${encodeURIComponent(sn)}/tr069/reboot`, {}, { timeout: 30_000 },
    );
    return res.data.data;
  },
  onuTr069FactoryReset: async (sn: string): Promise<{ ok: boolean; mensaje: string }> => {
    const res = await api.post<ApiRespuesta<{ ok: boolean; mensaje: string }>>(
      `/olt-nativo/onu/${encodeURIComponent(sn)}/tr069/factory-reset`, {}, { timeout: 30_000 },
    );
    return res.data.data;
  },
  onuTr069SetWifi: async (sn: string, dto: SetWifiLiveDto): Promise<OnuApplyResult> => {
    const res = await api.put<ApiRespuesta<OnuApplyResult>>(
      `/olt-nativo/onu/${encodeURIComponent(sn)}/tr069/wifi`, dto, { timeout: 60_000 },
    );
    return res.data.data;
  },
  onuTr069SetPppoe: async (sn: string, dto: SetPppoeLiveDto): Promise<OnuApplyResult> => {
    const res = await api.put<ApiRespuesta<OnuApplyResult>>(
      `/olt-nativo/onu/${encodeURIComponent(sn)}/tr069/pppoe`, dto, { timeout: 60_000 },
    );
    return res.data.data;
  },
  onuTr069SetAccesoWeb: async (sn: string, dto: SetAccesoWebDto): Promise<OnuApplyResult> => {
    const res = await api.put<ApiRespuesta<OnuApplyResult>>(
      `/olt-nativo/onu/${encodeURIComponent(sn)}/tr069/acceso-web`, dto, { timeout: 60_000 },
    );
    return res.data.data;
  },
};

// ─── Tipos ONU TR-069 (detalle LIVE) ──────────────────────────
export interface OnuWifiBand { band: '2.4' | '5'; index: number; enabled: boolean | null; ssid: string | null; }
export interface OnuPppLink { index: string; username: string | null; connectionStatus: string | null; externalIp: string | null; }
export interface OnuHost { hostname: string | null; ip: string | null; mac: string | null; active: boolean | null; conexion: '2.4' | '5' | 'wifi' | 'lan'; }
export interface OnuTr069Detalle {
  informing:   boolean;
  deviceId?:   string;
  lastInform?: string | null;
  info?: {
    serial?: string; manufacturer?: string; productClass?: string; modelName?: string;
    softwareVersion?: string; hardwareVersion?: string; mgmtIp?: string | null;
    uptimeSeconds?: number | null; profileMatched: boolean;
  };
  wifi?: OnuWifiBand[];
  ppp?:  OnuPppLink[];
  hosts?: OnuHost[];
}
export interface SetWifiLiveDto { band: '2.4' | '5'; enabled?: boolean; ssid?: string; password?: string; }
export interface SetPppoeLiveDto { username?: string; password?: string; }
export interface SetAccesoWebDto { adminUser?: string; adminPassword?: string; userUser?: string; userPassword?: string; }
export interface OnuApplyResult { ok: boolean; applied: number; total: number; fallidas: string[]; }

// ─── Perfil TR-069 por OLT ─────────────────────────────────────
export interface Tr069Profile {
  enabled: boolean; acsUrl: string | null; mgmtVlan: number | null;
  acsUsername: string | null; hasPassword: boolean;
}
export interface Tr069ProfileDto {
  enabled?: boolean; acsUrl?: string; mgmtVlan?: number; acsUsername?: string; acsPassword?: string;
}

export const oltTr069ProfileApi = {
  get: async (oltId: string): Promise<Tr069Profile> => {
    const res = await api.get<ApiRespuesta<Tr069Profile>>(`/olt-nativo/${oltId}/tr069-profile`);
    return res.data.data;
  },
  set: async (oltId: string, dto: Tr069ProfileDto): Promise<Tr069Profile> => {
    const res = await api.put<ApiRespuesta<Tr069Profile>>(`/olt-nativo/${oltId}/tr069-profile`, dto);
    return res.data.data;
  },
};
