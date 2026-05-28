import api from '@/lib/api';
import type { Contrato, Plan, Nodo, HistorialEntry, PaginaRespuesta, PaginaMeta, ApiRespuesta } from '@/types';
import type { Router } from '@/lib/api/mikrotik';

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
  clienteId:            string;
  planId:               string;
  routerId?:            string;
  nodoId?:              string;
  antenaApId?:          string;
  oltId?:               string;
  segmentoId?:          string;
  ipManual?:            string;
  fechaInicio:          string;
  diaFacturacion?:      number;
  descuentoPct?:        number;
  notasInternas?:       string;
  notasInstalacion?:    string;
  // PPPoE (se genera si no se pasan)
  usuarioPppoe?:        string;
  passwordPppoe?:       string;
  // Red / equipo
  macAddress?:          string;
  excluirFirewall?:     boolean;
  routes?:              string;
  ipAdministracion?:    string;
  tipoAntena?:          string;
  cajaNap?:             string;
  puertoNap?:           string;
  // Instalación
  direccionInstalacion?:  string;
  latitudInstalacion?:    number;
  longitudInstalacion?:   number;
  // Servicio / equipo
  tipoIpv4?:              string;
  descripcionServicio?:   string;
  precioMensual?:         number;
  comunidadSnmp?:         string;
  usuarioAntena?:         string;
  contrasenaAntena?:      string;
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
    const res = await api.get<ApiRespuesta<Contrato[]>>('/contratos', { params: filtros });
    return { data: res.data.data ?? [], meta: res.data.meta?.['meta'] as PaginaMeta };
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
    const res = await api.patch<ApiRespuesta<Contrato>>(`/contratos/${id}/activar`);
    return res.data.data;
  },

  aplicarProrroga: async (id: string, dto: ProrrogaDto): Promise<Contrato> => {
    const res = await api.post<ApiRespuesta<Contrato>>(`/contratos/${id}/prorroga`, dto);
    return res.data.data;
  },

  getHistorial: async (id: string): Promise<HistorialEntry[]> => {
    const res = await api.get<ApiRespuesta<HistorialEntry[]>>(`/contratos/${id}/historial`);
    return res.data.data ?? [];
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
    const res = await api.get<ApiRespuesta<Record<string, number>>>('/contratos/stats');
    return res.data.data;
  },

  aprovisionarOnu: async (id: string, onuSn: string): Promise<{ ok: boolean; mensaje: string }> => {
    const res = await api.post<ApiRespuesta<{ ok: boolean; mensaje: string }>>(
      `/contratos/${id}/aprovisionar-onu`,
      { onuSn },
    );
    return res.data.data;
  },
};

// ─── Planes API ───────────────────────────────────────────────
export const planesApi = {
  list: async (): Promise<Plan[]> => {
    const res = await api.get<ApiRespuesta<Plan[]>>('/planes');
    return res.data.data;
  },
};

// ─── Tipos segmentos ──────────────────────────────────────────
export interface SegmentoIpv4 {
  id:             string;
  nombre:         string;
  descripcion?:   string;
  redCidr:        string;
  gateway:        string;
  dnsPrimario:    string;
  dnsSecundario?: string;
  routerId?:      string;
  nodoId?:        string;
  tipoServicio:   string;
  vlanId?:        number;
  totalIps:       number;
  ipsUsadas:      number;
  ipsDisponibles: number;
  activo:         boolean;
}

export interface IpEntry {
  ip:     string;
  estado: 'libre' | 'asignada' | 'reservada';
}

export interface DisponibilidadSegmento {
  segmento: {
    ipsDisponibles: number;
    totalIps:       number;
    porcentajeUso:  number;
  };
  ips?:    IpEntry[];
  hayMas?: boolean;
}

export interface CreateSegmentoDto {
  nombre:         string;
  descripcion?:   string;
  redCidr:        string;
  gateway:        string;
  dnsPrimario?:   string;
  dnsSecundario?: string;
  routerId?:      string;
  nodoId?:        string;
  tipoServicio?:  string;
  vlanId?:        number;
  ipsReservadas?: string[];
}

export interface Olt {
  id:      string;
  nombre:  string;
  host?:   string;
  modelo?: string;
}

export interface SmartOltPerfil {
  id?:    string | number;
  name:   string;
}

export interface OnuSinAprovisionar {
  id?:           string;
  serial?:       string;
  pon_port?:     string;
  oltId?:        string;
  oltNombre?:    string;
}

export interface OnusPendientes {
  smartolt: OnuSinAprovisionar[];
  local:    OnuSinAprovisionar[];
}

// ─── Routers API (para selects) ───────────────────────────────
export const redesApi = {
  listRouters: async (): Promise<Router[]> => {
    const res = await api.get<ApiRespuesta<Router[]>>('/mikrotik/routers');
    return res.data.data ?? [];
  },
  listOlts: async (): Promise<Olt[]> => {
    const res = await api.get<ApiRespuesta<Olt[]>>('/smartolt/olts');
    return res.data.data ?? [];
  },
  listNodos: async (): Promise<Nodo[]> => {
    const res = await api.get<ApiRespuesta<Nodo[]>>('/monitoreo/nodos');
    return res.data.data ?? [];
  },
  listSegmentos: async (routerId?: string): Promise<SegmentoIpv4[]> => {
    const res = await api.get<ApiRespuesta<SegmentoIpv4[]>>('/contratos/segmentos', {
      params: routerId ? { routerId } : {},
    });
    return res.data.data ?? [];
  },
  createSegmento: async (dto: CreateSegmentoDto): Promise<SegmentoIpv4> => {
    const res = await api.post<ApiRespuesta<SegmentoIpv4>>('/contratos/segmentos', dto);
    return res.data.data;
  },
  updateSegmento: async (id: string, dto: Partial<CreateSegmentoDto>): Promise<SegmentoIpv4> => {
    const res = await api.put<ApiRespuesta<SegmentoIpv4>>(`/contratos/segmentos/${id}`, dto);
    return res.data.data;
  },

  deleteSegmento: async (id: string): Promise<void> => {
    await api.delete(`/contratos/segmentos/${id}`);
  },
  getDisponibilidad: async (id: string): Promise<DisponibilidadSegmento> => {
    const res = await api.get<ApiRespuesta<DisponibilidadSegmento>>(`/contratos/segmentos/${id}/disponibilidad`);
    return res.data.data;
  },
  getNextIp: async (id: string): Promise<string | null> => {
    const res = await api.get<ApiRespuesta<{ ip: string | null }>>(`/contratos/segmentos/${id}/next-ip`);
    return res.data.data?.ip ?? null;
  },
  listAntenasAP: async (routerId: string): Promise<{ id: string; nombreEmisor: string; ipAddress: string; tipoEquipo: string; status: string }[]> => {
    const res = await api.get<ApiRespuesta<{ id: string; nombreEmisor: string; ipAddress: string; tipoEquipo: string; status: string }[]>>(
      `/contratos/routers/${routerId}/antenas-ap`,
    );
    return res.data.data ?? [];
  },
  listPerfilesSmartolt: async (): Promise<SmartOltPerfil[]> => {
    const res = await api.get<ApiRespuesta<SmartOltPerfil[]>>('/smartolt/perfiles');
    return res.data.data ?? [];
  },
  onusNoAprovisionadas: async (oltId?: string): Promise<OnusPendientes> => {
    const res = await api.get<ApiRespuesta<OnusPendientes>>('/smartolt/onus/sin-aprovisionar', {
      params: oltId ? { oltId } : {},
    });
    return res.data.data ?? { smartolt: [], local: [] };
  },
};
