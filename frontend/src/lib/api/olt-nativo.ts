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
    slot:  number,
    port:  number,
  ): Promise<DiscoverResult> => {
    const res = await api.get<ApiRespuesta<DiscoverResult>>(
      `/olt-nativo/${oltId}/discover-onus`,
      { params: { slot, port } },
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
};
