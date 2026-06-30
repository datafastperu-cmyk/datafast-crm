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
  slot_id:      number;
  board_name:   string;
  status:       string;
  online_onus:  number;
  offline_onus: number;
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
  description?:    string | null;
}

export interface PythonFtthGponResponse {
  success: boolean;
  sn?:     string | null;
  olt_ip?: string | null;
  error?:  string;
}

export interface PythonFtthRollbackRequest {
  connection:      PythonConnectionPayload;
  slot:            number;
  port:            number;
  onu_id:          number;
  service_port_id: number | null;
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

export interface PythonFtthWanPppoeRequest {
  connection: PythonConnectionPayload;
  slot:       number;
  port:       number;
  onu_id:     number;
  vlan:       number;
  username:   string;
  password:   string;
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
