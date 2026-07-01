import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

// ─── Types ────────────────────────────────────────────────────

export type CalidadSenal = 'buena' | 'marginal' | 'critica' | 'sin_datos';

export interface OnuRow {
  sn:           string;
  slot:         number | null;
  port:         number | null;
  onuId:        number | null;
  estado:       string | null;
  oltId:        string;
  oltNombre:    string;
  oltMarca:     string;
  vlanId:       number | null;
  clienteId:    string | null;
  clienteNombre:string | null;
  zonaId:       string | null;
  zonaNombre:   string | null;
  contratoId:   string | null;
  rxPower:      number | null;
  txPower:      number | null;
  temperatura:  number | null;
  senalTs:      string | null;
  calidadSenal: CalidadSenal;
}

export interface OnuListResponse {
  data:   OnuRow[];
  total:  number;
  page:   number;
  limit:  number;
  pages:  number;
}

export interface OnuFilters {
  page?:    number;
  limit?:   number;
  oltId?:   string;
  estado?:  string;
  zonaId?:  string;
  calidad?: CalidadSenal;
  q?:       string;
  sort?:    string;
  dir?:     'ASC' | 'DESC';
}

export interface BatchSenalResponse {
  jobId:    string;
  total:    number;
  mensaje:  string;
}

export interface RefreshSenalResponse {
  sn:          string;
  rxPower:     number | null;
  txPower:     number | null;
  temperatura: number | null;
  stale:       boolean;
  error?:      string;
}

export interface VersionResponse {
  exitoso:          boolean;
  ontVersion?:      string;
  softwareVersion?: string;
  equipmentId?:     string;
  error?:           string;
}

// ─── API ─────────────────────────────────────────────────────

export const redOnusApi = {
  listar: async (filters: OnuFilters = {}): Promise<OnuListResponse> => {
    const params = new URLSearchParams();
    if (filters.page)    params.set('page',   String(filters.page));
    if (filters.limit)   params.set('limit',  String(filters.limit));
    if (filters.oltId)   params.set('oltId',  filters.oltId);
    if (filters.estado)  params.set('estado', filters.estado);
    if (filters.zonaId)  params.set('zonaId', filters.zonaId);
    if (filters.calidad) params.set('calidad', filters.calidad);
    if (filters.q)       params.set('q',      filters.q);
    if (filters.sort)    params.set('sort',   filters.sort);
    if (filters.dir)     params.set('dir',    filters.dir);
    const res = await api.get<ApiRespuesta<OnuListResponse>>(`/red/onus?${params.toString()}`);
    return res.data.data;
  },

  exportUrl: (filters: OnuFilters = {}): string => {
    const params = new URLSearchParams();
    if (filters.oltId)   params.set('oltId',  filters.oltId);
    if (filters.estado)  params.set('estado', filters.estado);
    if (filters.zonaId)  params.set('zonaId', filters.zonaId);
    if (filters.q)       params.set('q',      filters.q);
    return `/api/v1/red/onus/export?${params.toString()}`;
  },

  iniciarBatch: async (sns: string[]): Promise<BatchSenalResponse> => {
    const res = await api.post<ApiRespuesta<BatchSenalResponse>>(
      `/red/onus/señal-batch?sns=${sns.join(',')}`,
    );
    return res.data.data;
  },

  refreshSenal: async (sn: string): Promise<RefreshSenalResponse> => {
    const res = await api.post<ApiRespuesta<RefreshSenalResponse>>(`/red/onus/${sn}/señal`);
    return res.data.data;
  },

  suspender: async (sn: string): Promise<void> => {
    await api.post(`/red/onus/${sn}/suspender`);
  },

  rehabilitar: async (sn: string): Promise<void> => {
    await api.post(`/red/onus/${sn}/rehabilitar`);
  },

  resetear: async (sn: string): Promise<void> => {
    await api.post(`/red/onus/${sn}/resetear`);
  },

  getVersion: async (sn: string): Promise<VersionResponse> => {
    const res = await api.get<ApiRespuesta<VersionResponse>>(`/red/onus/${sn}/version`);
    return res.data.data;
  },
};
