import api from '@/lib/api';
import type { Nodo, Alerta, ApiRespuesta } from '@/types';

export interface FiltrosAlerta {
  nodoId?:   string;
  nivel?:    string;
  estado?:   string;
  page?:     number;
  limit?:    number;
}

export interface CreateNodoDto {
  nombre:          string;
  descripcion?:    string;
  tipo?:           string;
  ipMonitoreo:     string;
  routerId?:       string;
  oltId?:          string;
  snmpHabilitado?: boolean;
  snmpCommunity?:  string;
  snmpVersion?:    number;
  snmpInterfaceIndex?: number;
  pingHabilitado?: boolean;
  pingIntervaloSeg?: number;
  alertasHabilitadas?: boolean;
  latitud?:        number;
  longitud?:       number;
}

export interface CreateConfigAlertaDto {
  nodoId?:           string;
  metrica:           string;
  umbralWarning:     number;
  umbralCritical:    number;
  notificarWhatsapp?: boolean;
  telefonoDestino?:  string;
  descripcion?:      string;
}

export interface ConfigAlerta extends CreateConfigAlertaDto {
  id: string;
}

export interface MedicionHistorica {
  timestamp:    string;
  latenciaMs:   number | null;
  perdidaPct:   number;
  online:       boolean;
  cpuPct?:      number;
  memoriaPct?:  number;
  traficoRxBps?: number;
  traficoTxBps?: number;
  temperaturaC?: number;
}

export interface SnmpInterface {
  index:       number;
  descripcion: string;
  velocidad:   number;
  operStatus:  number;
  rxBytes:     number;
  txBytes:     number;
}

export const monitoreoApi = {

  // ── Nodos ──────────────────────────────────────────────────
  listNodos: async (): Promise<Nodo[]> => {
    const res = await api.get<ApiRespuesta<Nodo[]>>('/monitoreo/nodos');
    return res.data.data;
  },

  getNodo: async (id: string): Promise<Nodo> => {
    const res = await api.get<ApiRespuesta<Nodo>>(`/monitoreo/nodos/${id}`);
    return res.data.data;
  },

  createNodo: async (dto: CreateNodoDto): Promise<Nodo> => {
    const res = await api.post<ApiRespuesta<Nodo>>('/monitoreo/nodos', dto);
    return res.data.data;
  },

  updateNodo: async (id: string, dto: Partial<CreateNodoDto>): Promise<Nodo> => {
    const res = await api.put<ApiRespuesta<Nodo>>(`/monitoreo/nodos/${id}`, dto);
    return res.data.data;
  },

  deleteNodo: async (id: string): Promise<void> => {
    await api.delete(`/monitoreo/nodos/${id}`);
  },

  // ── Ping y SNMP ────────────────────────────────────────────
  pingNodo: async (id: string) => {
    const res = await api.post<ApiRespuesta>(`/monitoreo/nodos/${id}/ping`);
    return res.data.data;
  },

  pingIp: async (ip: string, count = 4) => {
    const res = await api.post<ApiRespuesta>('/monitoreo/ping', { ip, count });
    return res.data.data;
  },

  getSnmpInterfaces: async (id: string): Promise<SnmpInterface[]> => {
    const res = await api.get<ApiRespuesta<SnmpInterface[]>>(
      `/monitoreo/nodos/${id}/snmp/interfaces`,
    );
    return res.data.data ?? [];
  },

  testSnmp: async (id: string) => {
    const res = await api.get<ApiRespuesta>(`/monitoreo/nodos/${id}/snmp/test`);
    return res.data.data;
  },

  // ── Mediciones históricas ──────────────────────────────────
  getMediciones: async (id: string, horas = 24): Promise<MedicionHistorica[]> => {
    const res = await api.get<ApiRespuesta<MedicionHistorica[]>>(
      `/monitoreo/nodos/${id}/mediciones`,
      { params: { horas } },
    );
    return res.data.data ?? [];
  },

  // ── Dashboard ──────────────────────────────────────────────
  getDashboard: async () => {
    const res = await api.get<ApiRespuesta>('/monitoreo/dashboard');
    return res.data.data;
  },

  // ── Alertas ────────────────────────────────────────────────
  getAlertasActivas: async (): Promise<Alerta[]> => {
    const res = await api.get<ApiRespuesta<Alerta[]>>('/monitoreo/alertas');
    return res.data.data ?? [];
  },

  getHistorialAlertas: async (filtros: FiltrosAlerta = {}): Promise<Alerta[]> => {
    const res = await api.get<ApiRespuesta<Alerta[]>>('/monitoreo/alertas/historial', {
      params: filtros,
    });
    return res.data.data ?? [];
  },

  resolverAlerta: async (id: string, motivo?: string): Promise<void> => {
    await api.patch(`/monitoreo/alertas/${id}/resolver`, { motivo });
  },

  getResumenAlertas: async () => {
    const res = await api.get<ApiRespuesta>('/monitoreo/alertas');
    return res.data.data;
  },

  // ── Configuración de alertas ───────────────────────────────
  getConfigAlertas: async (): Promise<ConfigAlerta[]> => {
    const res = await api.get<ApiRespuesta<ConfigAlerta[]>>('/monitoreo/alertas/configuracion');
    return res.data.data ?? [];
  },

  createConfigAlerta: async (dto: CreateConfigAlertaDto) => {
    const res = await api.post<ApiRespuesta>('/monitoreo/alertas/configuracion', dto);
    return res.data.data;
  },

  deleteConfigAlerta: async (id: string): Promise<void> => {
    await api.delete(`/monitoreo/alertas/configuracion/${id}`);
  },

  // ── WebSocket stats ────────────────────────────────────────
  getWsStats: async () => {
    const res = await api.get<ApiRespuesta>('/monitoreo/ws/stats');
    return res.data.data;
  },

  // ── Scan manual ───────────────────────────────────────────
  forzarScan: async (): Promise<{ encolados: number }> => {
    const res = await api.post<ApiRespuesta<{ encolados: number }>>('/monitoreo/scan');
    return res.data.data;
  },
};

// ── Tipos de nodo ─────────────────────────────────────────────
export const TIPOS_NODO = [
  { value: 'router',        label: '📡 Router Mikrotik' },
  { value: 'switch',        label: '🔀 Switch' },
  { value: 'olt',           label: '🔷 OLT' },
  { value: 'antena',        label: '📶 Antena WISP' },
  { value: 'servidor',      label: '🖥 Servidor' },
  { value: 'enlace_uplink', label: '🔗 Enlace Uplink' },
  { value: 'cliente',       label: '👤 Cliente' },
] as const;

// ── Métricas de alerta ────────────────────────────────────────
export const METRICAS_ALERTA = [
  { value: 'ping_latencia',   label: 'Latencia de ping (ms)',      unidad: 'ms' },
  { value: 'ping_perdida',    label: 'Pérdida de paquetes (%)',     unidad: '%' },
  { value: 'cpu',             label: 'Uso de CPU (%)',              unidad: '%' },
  { value: 'memoria',         label: 'Uso de memoria (%)',          unidad: '%' },
  { value: 'trafico_bajada',  label: 'Tráfico bajada (bps)',        unidad: 'bps' },
  { value: 'trafico_subida',  label: 'Tráfico subida (bps)',        unidad: 'bps' },
  { value: 'temperatura',     label: 'Temperatura (°C)',            unidad: '°C' },
  { value: 'sesiones_pppoe',  label: 'Sesiones PPPoE activas',      unidad: '' },
  { value: 'senal_onu',       label: 'Señal ONU (dBm)',             unidad: 'dBm' },
] as const;
