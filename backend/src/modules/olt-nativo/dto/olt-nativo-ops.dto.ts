import {
  IsBoolean, IsIn, IsInt, IsIP, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ─── DTOs de entrada ──────────────────────────────────────────

export class ProvisionarOnuNativaDto {

  @ApiProperty({ description: 'UUID del contrato en estado ACTIVO — se valida estado antes de aprovisionar' })
  @IsUUID('4')
  contratoId: string;

  @ApiProperty({ description: 'UUID del cliente — para auditoría' })
  @IsUUID('4')
  clienteId: string;

  @ApiProperty({ example: 0 })
  @IsInt() @Min(0) @Max(7) @Type(() => Number)
  frame: number;

  @ApiProperty({ example: 1 })
  @IsInt() @Min(0) @Max(15) @Type(() => Number)
  slot: number;

  @ApiProperty({ example: 3 })
  @IsInt() @Min(0) @Max(15) @Type(() => Number)
  port: number;

  @ApiProperty({ example: 4, description: 'ID de la ONU dentro del puerto PON (1-128)' })
  @IsInt() @Min(1) @Max(128) @Type(() => Number)
  onuId: number;

  @ApiProperty({ example: 'HWTC1A2B3C4D' })
  @IsString() @MaxLength(16)
  sn: string;

  @ApiProperty({ example: 201 })
  @IsInt() @Min(1) @Max(4094) @Type(() => Number)
  vlan: number;

  @ApiProperty({ example: 201 })
  @IsInt() @Min(1) @Max(4094) @Type(() => Number)
  vlanGestion: number;

  @ApiProperty({ example: '100M-RESIDENCIAL' })
  @IsString() @MaxLength(100)
  profileSpeed: string;

  // ── Huawei-específicos ────────────────────────────────────
  @ApiPropertyOptional({ example: 1501, description: 'service-port ID único en la OLT Huawei' })
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  servicePortId?: number;

  @ApiPropertyOptional({ example: 10, description: 'traffic-table index en la OLT Huawei' })
  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  trafficIndex?: number;

  // ── Huawei MA5800 — modo perfil ───────────────────────────
  @ApiPropertyOptional({ example: 2, description: 'ID del ont-lineprofile en la OLT MA5800 (modo perfil)' })
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  lineprofileId?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID del ont-srvprofile en la OLT MA5800 (modo perfil)' })
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  srvprofileId?: number;

  @ApiPropertyOptional({ example: 'Cliente Residencial', description: 'Descripción libre para el comando ont add desc' })
  @IsOptional() @IsString() @MaxLength(64)
  description?: string;

  // ── ZTE-específicos ───────────────────────────────────────
  @ApiPropertyOptional({ example: 'ZTE-F660', description: 'Tipo/modelo de ONU para OLTs ZTE (ej: ZTE-F660, F601E)' })
  @IsOptional() @IsString() @MaxLength(50)
  onuType?: string;

  // ── Modo de operación ─────────────────────────────────────
  @ApiPropertyOptional({ example: 'bridge', description: '"bridge" (PPPoE externo, sin ont ipconfig) o "routing" (IPoE/DHCP en la ONU)' })
  @IsOptional() @IsIn(['bridge', 'routing'])
  onuMode?: string;
}

export class ObtenerMetricasDto {

  @ApiProperty({ example: 1 })
  @IsInt() @Min(0) @Max(15) @Type(() => Number)
  slot: number;

  @ApiProperty({ example: 3 })
  @IsInt() @Min(0) @Max(15) @Type(() => Number)
  port: number;

  @ApiProperty({ example: 4 })
  @IsInt() @Min(1) @Max(128) @Type(() => Number)
  onuId: number;

  @ApiPropertyOptional({ example: 'HWTC1A2B3C4D', description: 'SN para actualizar registro en BD' })
  @IsOptional() @IsString() @MaxLength(16)
  sn?: string;
}

// ─── Interfaces de respuesta (payloads entre NestJS y Python) ─

export interface PythonConnectionPayload {
  ip:       string;
  port:     number;
  username: string;
  password: string;   // en texto plano — nunca persistir en logs
  brand:    string;
}

export interface PythonOnuPayload {
  frame:           number;
  slot:            number;
  port:            number;
  onu_id:          number;
  sn:              string;
  vlan:            number;
  vlan_gestion:    number;
  profile_speed:   string;
  service_port_id?: number;
  traffic_index?:  number;
  onu_type?:       string;   // ZTE
  lineprofile_id?: number;   // Huawei MA5800 modo perfil
  srvprofile_id?:  number;   // Huawei MA5800 modo perfil
  description?:    string;   // Huawei MA5800 — desc en ont add
  onu_mode?:       string;   // "bridge" | "routing"
}

export interface PythonProvisionRequest {
  connection: PythonConnectionPayload;
  onu:        PythonOnuPayload;
}

export interface PythonProvisionResponse {
  success:  boolean;
  message:  string;
  olt_ip:   string;
  onu_sn:   string;
  details?: Record<string, unknown> | null;
}

export interface PythonAlarmInfo {
  level:   'warning' | 'critical' | 'error';
  message: string;
}

export interface PythonMetricsResponse {
  success:       boolean;
  rx_power_dbm:  number | null;
  tx_power_dbm:  number | null;
  temperature_c: number | null;
  alarm:         PythonAlarmInfo | null;
  raw?:          string;
  error?:        string;
}

// ─── Discover DTOs ───────────────────────────────────────────

export class DiscoverOnusQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Filtrar por slot (0-15)' })
  @IsOptional() @IsInt() @Min(0) @Max(15) @Type(() => Number)
  slot?: number;

  @ApiPropertyOptional({ example: 3, description: 'Filtrar por puerto PON (0-15)' })
  @IsOptional() @IsInt() @Min(0) @Max(15) @Type(() => Number)
  port?: number;
}

export class ClasificarOnusQueryDto {
  @ApiProperty({ example: 1, description: 'Slot de la tarjeta PON (0-16)' })
  @IsInt() @Min(0) @Max(16) @Type(() => Number)
  slot: number;

  @ApiProperty({ example: 8, description: 'Puerto PON (0-63)' })
  @IsInt() @Min(0) @Max(63) @Type(() => Number)
  port: number;
}

export interface PythonDiscoverRequest {
  connection: PythonConnectionPayload;
  slot:       number | null;
  port:       number | null;
}

export interface PythonOntFoundInfo {
  sn:         string;
  slot:       number;
  port:       number;
  ont_model?: string | null;
}

export interface PythonDiscoverResponse {
  success: boolean;
  total:   number;
  onus:    PythonOntFoundInfo[];
  error?:  string;
}

export interface DiscoverResult {
  success: boolean;
  total:   number;
  onus:    PythonOntFoundInfo[];
}

// ─── Batch status (cron de monitoreo) ────────────────────────────

export interface PythonOnuQueryInfo {
  slot:   number;
  port:   number;
  onu_id: number;
  sn?:    string | null;
}

export interface PythonBatchStatusRequest {
  connection: PythonConnectionPayload;
  onus:       PythonOnuQueryInfo[];
}

export interface PythonOnuStatusInfo {
  slot:          number;
  port:          number;
  onu_id:        number;
  sn:            string | null;
  run_state:     string;   // 'online' | 'offline' | 'unknown' | 'los' | etc.
  rx_power_dbm:  number | null;
  tx_power_dbm:  number | null;
  temperature_c: number | null;
}

export interface PythonBatchStatusResponse {
  success: boolean;
  total:   number;
  onus:    PythonOnuStatusInfo[];
  error?:  string;
}

// ─── Firmware Upgrade ─────────────────────────────────────────

export interface PythonFirmwareUpgradeRequest {
  connection:        PythonConnectionPayload;
  slot:              number;
  port:              number;
  onu_ids:           number[];
  firmware_file:     string;  // ruta absoluta en disco del VPS
  firmware_filename: string;
}

export interface PythonFirmwareJobProgress {
  onu_id:  number;
  status:  'pending' | 'transferring' | 'success' | 'failed';
  message: string | null;
}

export interface PythonFirmwareJobStatus {
  job_id:     string;
  olt_ip:     string;
  status:     'upgrading' | 'success' | 'failed' | 'partial';
  message:    string;
  progress:   PythonFirmwareJobProgress[];
  started_at: string;
  updated_at: string;
}

// ─── DTOs de entrada para NestJS ──────────────────────────────

export class IniciarFirmwareUpgradeDto {
  @ApiProperty({ example: 1 })
  @IsInt() @Min(0) @Max(15) @Type(() => Number)
  slot: number;

  @ApiProperty({ example: 3 })
  @IsInt() @Min(0) @Max(15) @Type(() => Number)
  port: number;

  // onuIds viene como JSON string en FormData (multipart)
  @ApiProperty({ example: '[1,2,3]', description: 'JSON array de ONU IDs' })
  @IsString()
  onuIds: string;
}

// ─── Respuesta del historial ───────────────────────────────────

export interface FirmwareJobResult {
  historialId:      string;
  oltId:            string;
  oltNombre:        string;
  firmwareFilename: string;
  firmwareSizeBytes: number;
  slot:             number;
  port:             number;
  onuIds:           number[];
  estado:           string;
  pythonJobId:      string | null;
  resultado:        Array<{ onu_id: number; status: string; message: string }> | null;
  errorMsg:         string | null;
  createdAt:        string;
  updatedAt:        string;
}

export interface OnuActivaInfo {
  id:          string;
  serialNumber: string;
  onuId:       number;
  ponSlot:     number;
  ponPortNum:  number;
  estado:      string;
}

// ─── Deprovision ONU ─────────────────────────────────────────

export interface PythonDeprovisionOnuPayload {
  slot:            number;
  port:            number;
  onu_id:          number;
  service_port_id: number | null;
  rack:            number;
}

export interface PythonDeprovisionRequest {
  connection: PythonConnectionPayload;
  onu:        PythonDeprovisionOnuPayload;
}

export interface PythonDeprovisionResponse {
  success:  boolean;
  message:  string;
  olt_ip:   string;
  onu_id:   number;
  details?: Record<string, unknown> | null;
}

// ─── Verify ONU ──────────────────────────────────────────────

export interface PythonVerifyOnuRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
  onu_id:     number;
}

export interface PythonVerifyOnuResponse {
  success:       boolean;
  run_state:     string | null;
  rx_power_dbm:  number | null;
  tx_power_dbm:  number | null;
  temperature_c: number | null;
  error?:        string;
}

// ─── Test Connection SSH ──────────────────────────────────────

export interface PythonTestConexionRequest {
  connection: PythonConnectionPayload;
}

export interface PythonTestConexionResponse {
  success:    boolean;
  latency_ms: number | null;
  error?:     string;
}

// ─── Respuestas finales hacia el frontend ─────────────────────

export interface ProvisionResult {
  success:         boolean;
  message:         string;
  oltIp:           string;
  onuSn:           string;
  metodoConexion:  string;
  details?:        Record<string, unknown> | null;
}

export interface MetricasOnuResult {
  status:           'online' | 'offline' | 'degraded';
  metricsAvailable: boolean;
  rxPowerDbm?:      number | null;
  txPowerDbm?:      number | null;
  temperatureC?:    number | null;
  alarm?:           PythonAlarmInfo | null;
}

// ─── Proveedor Config DTOs ────────────────────────────────────

export class UpsertProveedorOltDto {
  @ApiProperty({ enum: ['nativo_ssh', 'nativo_snmp', 'smartolt', 'adminolt'] })
  @IsString()
  tipo: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @IsInt() @Min(1) @Max(99)
  @Type(() => Number)
  prioridad?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  activo?: boolean;

  // ── Nativo SSH / SNMP ──────────────────────────────────────
  @ApiPropertyOptional({ example: '10.0.50.2' })
  @IsOptional() @IsString()
  ip?: string;

  @ApiPropertyOptional({ example: 22 })
  @IsOptional() @IsInt() @Min(1) @Max(65535)
  @Type(() => Number)
  port?: number;

  @ApiPropertyOptional({ example: 'admin' })
  @IsOptional() @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Contraseña en texto plano — se cifra antes de persistir' })
  @IsOptional() @IsString()
  password?: string;

  @ApiPropertyOptional({ enum: ['huawei', 'zte', 'vsol', 'cdata'] })
  @IsOptional() @IsString()
  brand?: string;

  // ── SmartOLT / AdminOLT ────────────────────────────────────
  @ApiPropertyOptional({ example: 'https://app.smartolt.com' })
  @IsOptional() @IsString()
  baseUrl?: string;

  @ApiPropertyOptional({ description: 'API Key en texto plano — se cifra antes de persistir' })
  @IsOptional() @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ example: 'olt-uuid-en-plataforma-externa' })
  @IsOptional() @IsString()
  oltIdExterno?: string;
}

// ─── OLT Integración (SmartOLT / AdminOLT) ──────────────────

export class CrearOltIntegracionDto {
  @ApiProperty({ example: 'OLT Norte SmartOLT' })
  @IsNotEmpty() @IsString() @MaxLength(150)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(1000)
  descripcion?: string;

  @ApiProperty({ enum: ['huawei', 'zte', 'vsol', 'cdata'] })
  @IsNotEmpty() @IsString()
  marca: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  modelo?: string;

  @ApiProperty({ example: '10.0.50.10' })
  @IsIP()
  ipGestion: string;

  @ApiProperty()
  @IsUUID('4')
  routerId: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsInt() @Min(1) @Max(64) @Type(() => Number)
  slotsTotales?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional() @IsInt() @Min(1) @Max(128) @Type(() => Number)
  puertosPorSlot?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  ubicacion?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(-90) @Max(90) @Type(() => Number)
  latitud?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(-180) @Max(180) @Type(() => Number)
  longitud?: number;

  @ApiProperty({ example: 'https://app.smartolt.com' })
  @IsNotEmpty() @IsString() @MaxLength(500)
  baseUrl: string;

  @ApiProperty({ description: 'API Key en texto plano — se cifra antes de persistir' })
  @IsNotEmpty() @IsString() @MaxLength(500)
  apiKey: string;

  @ApiPropertyOptional({ example: 'olt-uuid-externo' })
  @IsOptional() @IsString() @MaxLength(100)
  oltIdExterno?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @IsInt() @Min(1) @Max(99) @Type(() => Number)
  prioridad?: number;
}

export interface ValidarIpResult {
  disponible: boolean;
  oltNombre?: string;
  seccion?:   'nativo' | 'smartolt' | 'adminolt';
}

// ─── Perfiles MA5800 ──────────────────────────────────────────

export interface PythonProfileInfo {
  profile_id: number;
  name:       string;
}

export interface PythonTrafficTableInfo {
  index:     number;
  name:      string;
  cir_kbps:  number | null;
  pir_kbps:  number | null;
  cbs_bytes?: number | null;
  pbs_bytes?: number | null;
}

export interface PythonListProfilesRequest {
  connection: PythonConnectionPayload;
}

export interface PythonListProfilesResponse {
  success:        boolean;
  lineprofiles:   PythonProfileInfo[];
  srvprofiles:    PythonProfileInfo[];
  traffic_tables: PythonTrafficTableInfo[];
  error?:         string;
}

export interface OltPerfilesResult {
  lineprofiles:   PythonProfileInfo[];
  srvprofiles:    PythonProfileInfo[];
  traffic_tables: PythonTrafficTableInfo[];
}

// ─── ONT Reset ───────────────────────────────────────────────

export interface PythonOntResetRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
  onu_id:     number;
}

export interface PythonOntResetResponse {
  success: boolean;
  message: string;
  error?:  string;
}

// ─── Board Topology ──────────────────────────────────────────

export interface PythonBoardTopologyRequest {
  connection: PythonConnectionPayload;
}

export interface PythonBoardSlotInfo {
  slot_id:        number;
  board_name:     string;
  status:         string;
  online_onus:    number;
  offline_onus:   number;
  ports_per_slot: number | null;
}

export interface PythonBoardTopologyResponse {
  success: boolean;
  slots:   PythonBoardSlotInfo[];
  error?:  string;
}

// ─── ONT Version ─────────────────────────────────────────────

export interface PythonOntVersionRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
  onu_id:     number;
}

export interface PythonOntVersionResponse {
  success:          boolean;
  ont_version:      string | null;
  software_version: string | null;
  equipment_id:     string | null;
  error?:           string;
}

// ─── FTTH Two-Phase Provisioning ─────────────────────────────

export interface PythonFtthGponRequest {
  connection:      PythonConnectionPayload;
  frame:           number;
  slot:            number;
  port:            number;
  onu_id:          number;
  sn:              string;
  service_port_id: number;
  vlan:            number;
  lineprofile_id:  number;
  srvprofile_id:   number;
  traffic_index_down?: number | null;  // outbound bajada; null = índice 0 sin límite
  traffic_index_up?:   number | null;  // inbound subida;  null = índice 0 sin límite
  description?:        string | null;
}

export interface PythonFtthGponResponse {
  success: boolean;
  sn?:     string | null;
  olt_ip?: string | null;
  error?:  string;
}

export interface PythonFtthRollbackRequest {
  connection:            PythonConnectionPayload;
  slot:                  number;
  port:                  number;
  onu_id:                number;
  service_port_id:       number | null;
  mgmt_service_port_id?: number | null;
}

// Carril de bootstrap TR-069 (ZTP): mgmt WAN DHCP + service-port GEM2 + FEC.
// La ONU recibe la ACS URL por DHCP Option 43 → aparece sola en GenieACS.
export interface PythonFtthBootstrapRequest {
  connection:           PythonConnectionPayload;
  slot:                 number;
  port:                 number;
  onu_id:               number;
  mgmt_vlan:            number;
  mgmt_service_port_id: number;
  traffic_index?:       number;
  priority?:            number;
}

export interface PythonFtthBootstrapResponse {
  success: boolean;
  olt_ip?: string | null;
  error?:  string;
}

export interface PythonFtthOntIdsRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
}

export interface PythonFtthOntIdsResponse {
  ont_ids: number[];
}

export interface PythonFtthRollbackResponse {
  success: boolean;
  error?:  string;
}

export interface PythonFtthPollRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
  onu_id:     number;
  max_wait:   number;
}

export interface PythonFtthPollResponse {
  success:    boolean;
  run_state?: string | null;
  timeout:    boolean;
  error?:     string;
}

export interface PythonFtthCheckMgmtIpRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
  onu_id:     number;
}

export interface PythonFtthCheckMgmtIpResponse {
  has_ip: boolean;
  ip?:    string | null;
  error?: string | null;
}

export interface PythonFtthCheckWanRequest {
  connection:        PythonConnectionPayload;
  slot:              number;
  port:              number;
  onu_id:            number;
  expected_username: string;
}

export interface PythonFtthCheckWanResponse {
  ok:        boolean;
  connected: boolean;
  username?: string | null;
  error?:    string | null;
}

export interface PythonFtthWanPppoeRequest {
  connection:  PythonConnectionPayload;
  slot:        number;
  port:        number;
  onu_id:      number;
  vlan:        number;
  mode?:       'pppoe' | 'static' | 'dhcp';
  username?:   string | null;
  password?:   string | null;
  ip_address?: string | null;
  mask?:       string | null;
  gateway?:    string | null;
  pri_dns?:    string | null;
}

export interface PythonFtthWanResponse {
  success: boolean;
  olt_ip?: string | null;
  onu_id?: number | null;
  error?:  string;
}

export interface PythonOntSuspendRequest {
  connection:      PythonConnectionPayload;
  slot:            number;
  port:            number;
  onu_id:          number;
  service_port_id: number;
}

export interface PythonOntSuspendResponse {
  success: boolean;
  message: string;
  error?:  string;
}

export interface PythonChangeLineprofileRequest {
  connection:         PythonConnectionPayload;
  slot:               number;
  port:               number;
  onu_id:             number;
  service_port_id:    number;
  traffic_index_down: number;
  traffic_index_up:   number;
}

export interface PythonChangeLineprofileResponse {
  success:            boolean;
  message:            string;
  traffic_index_down: number | null;
  traffic_index_up:   number | null;
  error?:             string;
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

// ─── Health Snapshot ──────────────────────────────────────────

export interface PythonHealthBoardInfo {
  slot:         number;
  board_type:   string;
  state:        string;
  onu_count:    number;
  onu_capacity: number;
  online_onus:  number;
  offline_onus: number;
}

export interface PythonHealthPomInfo {
  slot:         number;
  port:         number;
  temp_celsius: number | null;
  tx_dbm:       number | null;
  rx_dbm:       number | null;
  voltage_mv:   number | null;
  laser_ma:     number | null;
  state:        string | null;
}

export interface PythonHealthSnapshotRequest {
  connection:  PythonConnectionPayload;
  include_pom: boolean;
}

export interface PythonHealthSnapshotResponse {
  success: boolean;
  boards:  PythonHealthBoardInfo[];
  pom:     PythonHealthPomInfo[];
  error?:  string;
}

// ─── Wizard: Topología completa ───────────────────────────────

export interface PythonWizardBoardInfo {
  slot:         number;
  board_type:   string;
  state:        string;
  onu_count:    number;
  onu_capacity: number;
  online_onus:  number;
  offline_onus: number;
}

export interface PythonWizardVlanInfo {
  vlan_id: number;
  name:    string;
  vlan_type?:  string | null;   // smart | mux | standard | super
  attribute?:  string | null;
  serv_ports?: number | null;   // uso real (service-ports activos)
}

export interface PythonWizardTopologyRequest {
  connection: PythonConnectionPayload;
}

export interface PythonWizardTopologyResponse {
  success:          boolean;
  model:            string | null;
  firmware_version: string | null;
  boards:           PythonWizardBoardInfo[];
  vlans:            PythonWizardVlanInfo[];
  traffic_tables:   PythonTrafficTableInfo[];
  line_profiles:    PythonProfileInfo[];
  service_profiles: PythonProfileInfo[];
  error?:           string;
}

// ─── Config real SNMP/NTP ──────────────────────────────────────

export interface PythonSnmpCommunityInfo {
  name:   string;
  access: 'read' | 'write';
}

export interface PythonNtpServerInfo {
  source:  string;
  stratum: number | null;
  reach:   number;   // 0 = nunca sincronizó (RFC 5905)
  status:  string;
}

export interface PythonSnmpNtpConfigRequest {
  connection: PythonConnectionPayload;
}

export interface PythonSnmpNtpConfigResponse {
  success:          boolean;
  snmp_communities: PythonSnmpCommunityInfo[];
  snmp_versions:    string[];
  ntp_servers:      PythonNtpServerInfo[];
  error?:           string;
}

export interface PythonApplyNtpServersRequest {
  connection: PythonConnectionPayload;
  servers:    string[];
}

export interface PythonApplyNtpServersResponse {
  success:     boolean;
  ntp_servers: PythonNtpServerInfo[];
  error?:      string;
}

export interface PythonServicePortInfo {
  index:   number;
  vlan_id: number;
  state:   string;
}

export interface PythonServicePortsRequest {
  connection: PythonConnectionPayload;
}

export interface PythonServicePortsResponse {
  success: boolean;
  ports:   PythonServicePortInfo[];
  error?:  string;
}

// ─── VLAN CLI Operations ─────────────────────────────────────

export interface PythonVlanAddRequest {
  connection: PythonConnectionPayload;
  vlan_id:    number;
  name:       string;
}

export interface PythonVlanAddResponse {
  success: boolean;
  vlan_id: number | null;
  error?:  string;
}

export interface PythonVlanDeleteRequest {
  connection: PythonConnectionPayload;
  vlan_id:    number;
}

export interface PythonVlanDeleteResponse {
  success: boolean;
  error?:  string;
}

// ─── Versión / modelo real de la OLT ─────────────────────────

export interface PythonVersionInfoRequest {
  connection: PythonConnectionPayload;
}

export interface PythonVersionInfoResponse {
  success:  boolean;
  model:    string | null;
  firmware: string | null;
  patch:    string | null;
  error?:   string;
}

// ─── ONT service-profiles ("tipos de ONU") ───────────────────

export interface PythonSrvProfileAddRequest {
  connection: PythonConnectionPayload;
  name: string;
  eth:  number;
  pots: number;
  catv: number;
}

export interface PythonSrvProfileAddResponse {
  success:    boolean;
  profile_id: number | null;
  name:       string | null;
  error?:     string;
}

export interface PythonSrvProfileDeleteRequest {
  connection: PythonConnectionPayload;
  name: string;
}

export interface PythonSrvProfileDeleteResponse {
  success: boolean;
  error?:  string;
}

export interface PythonLineProfileAddRequest {
  connection:   PythonConnectionPayload;
  name:         string;
  dba_name:     string;
  dba_max_kbps: number;
}

export interface PythonLineProfileAddResponse {
  success:        boolean;
  profile_id:     number | null;
  name:           string | null;
  dba_profile_id: number | null;
  dba_name:       string | null;
  error?:         string;
}

export interface PythonLineProfileDeleteRequest {
  connection: PythonConnectionPayload;
  name:       string;
  dba_name?:  string | null;
}

export interface PythonLineProfileDeleteResponse {
  success:        boolean;
  dba_eliminado?: boolean | null;
  error?:         string;
}

// ─── Uplink VLAN tagging (Incremento 9b) ─────────────────────

export interface PythonUplinkVlansRequest {
  connection: PythonConnectionPayload;
  port_path:  string;   // ej. '0/9/0'
}

export interface PythonUplinkVlansResponse {
  success:  boolean;
  vlan_ids: number[];
  error?:   string;
}

export interface PythonUplinkTagRequest {
  connection: PythonConnectionPayload;
  vlan_id:    number;
  port_path:  string;
}

export interface PythonUplinkTagResponse {
  success:  boolean;
  vlan_ids: number[];   // estado del puerto releído tras el tag
  error?:   string;
}

// ─── Traffic Table CLI Operations ────────────────────────────

export interface PythonTrafficTableAddRequest {
  connection: PythonConnectionPayload;
  name:       string;
  cir_kbps:   number;
  pir_kbps:   number;
  cbs_bytes?: number | null;
  pbs_bytes?: number | null;
}

export interface PythonTrafficTableAddResponse {
  success: boolean;
  index:   number | null;
  name:    string | null;
  error?:  string;
}

export interface PythonTrafficTableDeleteRequest {
  connection: PythonConnectionPayload;
  index:      number;
}

export interface PythonTrafficTableDeleteResponse {
  success: boolean;
  error?:  string;
}

export interface PythonTrafficTableEditRequest {
  connection: PythonConnectionPayload;
  index:      number;
  name:       string;
  cir_kbps:   number;
  pir_kbps:   number;
  cbs_bytes?: number | null;
  pbs_bytes?: number | null;
}

export interface PythonTrafficTableEditResponse {
  success:    boolean;
  new_index:  number | null;
  error?:     string;
}

// ── PON Port Health (POST /api/v1/olt/health/pon-ports) ──────
export interface PythonPonPortInfo {
  slot:         number;
  port:         number;
  port_type:    string;
  admin_state:  string;
  oper_state:   string;
  autofind:     string;
  onus_total:   number;
  onus_online:  number;
  onus_offline: number;
  max_capacity: number;
}

export interface PythonPonPortsRequest {
  connection: PythonConnectionPayload;
  slot:       number;
}

export interface PythonPonPortsResponse {
  success: boolean;
  slot:    number;
  ports:   PythonPonPortInfo[];
  error?:  string;
}

// ── Clasificación de ONUs (POST /api/v1/olt/onus/classify) ────
export interface PythonClassifyOnusRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
}

export interface PythonClassifiedOnu {
  onu_id:           number;
  sn:               string | null;
  run_state:        string | null;
  control_flag:     string | null;
  config_state:     string | null;
  estado_operativo: string;   // online|apagada|ruptura_fibra|desactivada|offline
  down_cause:       string | null;
  dying_gasp_time:  string | null;
  rx_power_dbm:     number | null;
  tx_power_dbm:     number | null;
}

export interface PythonAutofindOnu {
  slot:  number | null;
  port:  number | null;
  sn:    string | null;
  model: string | null;
}

export interface PythonClassifyOnusResponse {
  success:  boolean;
  slot:     number;
  port:     number;
  onus:     PythonClassifiedOnu[];
  autofind: PythonAutofindOnu[];
  error?:   string;
}

// ── Wizard Commit (NestJS side) ───────────────────────────────

export interface WizardCommitDto {
  nombre:        string;
  ipGestion:     string;
  puerto:        number;
  usuario:       string;
  contrasena:    string;
  marca:         string;
  modelo:        string;
  firmware?:     string;
  zonaId?:       string;
  ubicacion?:    string;
  latitud?:      number;
  longitud?:     number;
  descripcion?:  string;
  // ── Pipeline de adopción (Incremento 10) ─────────────────────
  // brownfield: OLT en producción — el ERP respeta lo existente y crea su
  //   ecosistema paralelo (la reconciliación de pools corre en cada sync).
  // greenfield: OLT nueva — el baseline define la puesta en marcha completa.
  escenario?:    'greenfield' | 'brownfield';
  // Baseline a asignar al crear — el plan de convergencia queda disponible
  // de inmediato en el tab Baseline tras el primer sync.
  baselineId?:   string;
  vlans?:        Array<{ vlan_id: number; nombre: string }>;
  trafficTables?: Array<{ index: number; name: string; cir_kbps?: number; pir_kbps?: number }>;
}
