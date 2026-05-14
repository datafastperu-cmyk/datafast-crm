import api from '@/lib/api';
import type { Contrato, Plan, PaginaRespuesta, ApiRespuesta } from '@/types';

// ─── Filtros ──────────────────────────────────────────────────
export interface FiltrosContrato {
  search?:        string;
  estado?:        string;
  planId?:        string;
  routerId?:      string;
  clienteId?:     string;
  conDeuda?:      boolean;
  aprovisionado?: boolean;
  page?:          number;
  limit?:         number;
  orderBy?:       string;
  order?:         'ASC' | 'DESC';
}

// ─── DTOs ─────────────────────────────────────────────────────
export interface CreateContratoDto {
  clienteId:       string;
  planId:          string;
  routerId?:       string;
  oltId?:          string;
  segmentoId?:     string;
  fechaInicio:     string;
  diaFacturacion?: number;
  descuentoPct?:   number;
  notasInternas?:  string;
  // PPPoE (se genera si no se pasan)
  usuarioPppoe?:   string;
  passwordPppoe?:  string;
}

export interface CambiarEstadoDto {
  estado:  string;
  motivo?: string;
}

export interface ProrrogaDto {
  dias:    number;
  motivo?: string;
}

export interface AprovisionarDto {
  contratoId:     string;
  clienteId:      string;
  oltId:          string;
  serialNumber?:  string;
  ponPort:        string;
  perfilSmartolt: string;
  vlanId:         number;
  vlanModo?:      string;
  routerId:       string;
  segmentoId?:    string;
  ipManual?:      string;
  notificarWhatsApp?: boolean;
  rollbackEnError?:   boolean;
  omitirQueue?:       boolean;
}

export interface ResultadoPasoFtth {
  paso:       number;
  nombre:     string;
  estado:     'ok' | 'error' | 'omitido' | 'revertido';
  detalle:    string;
  duracionMs?: number;
  datos?:     Record<string, any>;
}

export interface ResultadoAprovisionamiento {
  pasos:               ResultadoPasoFtth[];
  exitoso:             boolean;
  contratoId:          string;
  ipAsignada?:         string;
  usuarioPppoe?:       string;
  onuId?:              string;
  serialNumber?:       string;
  duracionTotalMs?:    number;
  mensajeFinal:        string;
  rollbackEjecutado?:  boolean;
  pasosFallidos?:      number[];
}

// ─── Contratos API ────────────────────────────────────────────
export const contratosApi = {

  list: async (filtros: FiltrosContrato = {}): Promise<PaginaRespuesta<Contrato>> => {
    const res = await api.get<ApiRespuesta>('/contratos', { params: filtros });
    return { data: res.data.data, meta: res.data.meta?.meta };
  },

  getById: async (id: string): Promise<Contrato> => {
    const res = await api.get<ApiRespuesta<Contrato>>(`/contratos/${id}`);
    return res.data.data;
  },

  create: async (dto: CreateContratoDto): Promise<Contrato> => {
    const res = await api.post<ApiRespuesta<Contrato>>('/contratos', dto);
    return res.data.data;
  },

  update: async (id: string, dto: Partial<CreateContratoDto>): Promise<Contrato> => {
    const res = await api.put<ApiRespuesta<Contrato>>(`/contratos/${id}`, dto);
    return res.data.data;
  },

  cambiarEstado: async (id: string, dto: CambiarEstadoDto): Promise<Contrato> => {
    const res = await api.patch<ApiRespuesta<Contrato>>(`/contratos/${id}/estado`, dto);
    return res.data.data;
  },

  activar: async (id: string): Promise<Contrato> => {
    const res = await api.post<ApiRespuesta<Contrato>>(`/contratos/${id}/activar`);
    return res.data.data;
  },

  aplicarProrroga: async (id: string, dto: ProrrogaDto): Promise<Contrato> => {
    const res = await api.post<ApiRespuesta<Contrato>>(`/contratos/${id}/prorroga`, dto);
    return res.data.data;
  },

  getHistorial: async (id: string) => {
    const res = await api.get<ApiRespuesta>(`/contratos/${id}/historial`);
    return res.data.data;
  },

  getFacturas: async (id: string) => {
    const res = await api.get<ApiRespuesta>(`/facturacion?contratoId=${id}&limit=24`);
    return res.data.data;
  },

  // ── Aprovisionamiento FTTH ──────────────────────────────────
  aprovisionar: async (dto: AprovisionarDto): Promise<ResultadoAprovisionamiento> => {
    const res = await api.post<ApiRespuesta<ResultadoAprovisionamiento>>(
      '/aprovisionamiento/ftth', dto,
    );
    return res.data.data;
  },

  rollback: async (contratoId: string, motivo?: string) => {
    const res = await api.post<ApiRespuesta>('/aprovisionamiento/rollback', {
      contratoId, motivo, eliminarSmartolt: true, eliminarPppoe: true, liberarIp: true,
    });
    return res.data.data;
  },

  renotificar: async (contratoId: string) => {
    const res = await api.post<ApiRespuesta>(
      `/aprovisionamiento/notificar/${contratoId}`,
    );
    return res.data.data;
  },

  getStats: async (): Promise<Record<string, number>> => {
    const res = await api.get<ApiRespuesta>('/contratos/stats');
    return res.data.data;
  },
};

// ─── Planes API ───────────────────────────────────────────────
export const planesApi = {
  list: async (): Promise<Plan[]> => {
    const res = await api.get<ApiRespuesta<Plan[]>>('/planes?activo=true');
    return res.data.data;
  },
};

// ─── Routers API (para selects) ───────────────────────────────
export const redesApi = {
  listRouters: async () => {
    const res = await api.get<ApiRespuesta>('/mikrotik/routers');
    return res.data.data ?? [];
  },
  listOlts: async () => {
    const res = await api.get<ApiRespuesta>('/smartolt/olts');
    return res.data.data ?? [];
  },
  listSegmentos: async () => {
    const res = await api.get<ApiRespuesta>('/contratos/segmentos');
    return res.data.data ?? [];
  },
  listPerfilesSmartolt: async () => {
    const res = await api.get<ApiRespuesta>('/smartolt/perfiles');
    return res.data.data ?? [];
  },
  onusNoAprovisionadas: async (oltId?: string) => {
    const res = await api.get<ApiRespuesta>('/smartolt/onus/sin-aprovisionar', {
      params: oltId ? { oltId } : {},
    });
    return res.data.data ?? { smartolt: [], local: [] };
  },
};
