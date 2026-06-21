import {
  IsInt, IsOptional, IsString, IsUUID,
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

  // ── ZTE-específicos ───────────────────────────────────────
  @ApiPropertyOptional({ example: 'ZTE-F660', description: 'Tipo/modelo de ONU para OLTs ZTE (ej: ZTE-F660, F601E)' })
  @IsOptional() @IsString() @MaxLength(50)
  onuType?: string;
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
  sn:   string;
  slot: number;
  port: number;
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
