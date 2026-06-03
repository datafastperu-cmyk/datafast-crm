import api from '@/lib/api';
import type { ApiRespuesta, PaginaRespuesta, PaginaMeta } from '@/types';

// ─── Tipos ────────────────────────────────────────────────────

export type EstadoProyecto = 'activo' | 'completado' | 'cancelado';

export interface ProyectoInversion {
  id:               string;
  nombreProyecto:   string;
  sectorId:         string;
  inversionInicial: number;
  tasaDescuento:    number;
  fechaInicio:      string;
  descripcion?:     string;
  estado:           EstadoProyecto;
  createdAt:        string;
}

export interface CreateProyectoInversionDto {
  nombreProyecto:   string;
  sectorId:         string;
  inversionInicial: number;
  tasaDescuento:    number;
  fechaInicio:      string;
  descripcion?:     string;
}

export interface UpdateProyectoInversionDto {
  nombreProyecto?:  string;
  inversionInicial?: number;
  tasaDescuento?:   number;
  fechaInicio?:     string;
  descripcion?:     string;
  estado?:          EstadoProyecto;
}

export interface FilterProyectoDto {
  estado?:   EstadoProyecto;
  sectorId?: string;
  page?:     number;
  limit?:    number;
}

export interface RatiosFinancieros {
  proyectoId:       string;
  nombreProyecto:   string;
  sectorId:         string;
  inversionInicial: number;
  tasaDescuento:    number;
  fechaInicio:      string;
  mesesEvaluados:   number;
  flujosMensuales:  number[];
  van:              number;
  tir:              number;
  paybackMeses:     number | null;
  esViable:         boolean;
}

// ─── API ──────────────────────────────────────────────────────

export const proyectosInversionApi = {

  list: async (filtros: FilterProyectoDto = {}): Promise<PaginaRespuesta<ProyectoInversion>> => {
    const res = await api.get<ApiRespuesta<ProyectoInversion[]>>('/proyectos-inversion', { params: filtros });
    return { data: res.data.data ?? [], meta: res.data.meta?.['meta'] as PaginaMeta };
  },

  getById: async (id: string): Promise<ProyectoInversion> => {
    const res = await api.get<ApiRespuesta<ProyectoInversion>>(`/proyectos-inversion/${id}`);
    return res.data.data;
  },

  getRatios: async (id: string): Promise<RatiosFinancieros> => {
    const res = await api.get<ApiRespuesta<RatiosFinancieros>>(`/proyectos-inversion/${id}/ratios`);
    return res.data.data;
  },

  create: async (dto: CreateProyectoInversionDto): Promise<ProyectoInversion> => {
    const res = await api.post<ApiRespuesta<ProyectoInversion>>('/proyectos-inversion', dto);
    return res.data.data;
  },

  update: async (id: string, dto: UpdateProyectoInversionDto): Promise<ProyectoInversion> => {
    const res = await api.patch<ApiRespuesta<ProyectoInversion>>(`/proyectos-inversion/${id}`, dto);
    return res.data.data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/proyectos-inversion/${id}`);
  },
};
