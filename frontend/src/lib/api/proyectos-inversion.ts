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
    const res = await api.get('/proyectos-inversion', { params: filtros });
    // backend: ApiResponse.ok(PaginatedResult) → res.data.data = { data:[], total, page, limit }
    const pag  = res.data?.data;
    const items: ProyectoInversion[] = Array.isArray(pag) ? pag : (pag?.data ?? []);
    return {
      data: items,
      meta: {
        total:      pag?.total ?? 0,
        page:       pag?.page  ?? 1,
        limit:      pag?.limit ?? 50,
        totalPages: Math.ceil((pag?.total ?? 0) / (pag?.limit ?? 50)),
        hasNext:    (pag?.page ?? 1) * (pag?.limit ?? 50) < (pag?.total ?? 0),
        hasPrev:    (pag?.page ?? 1) > 1,
      },
    };
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
