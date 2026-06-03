import api from '@/lib/api';
import type { ApiRespuesta, PaginaRespuesta, PaginaMeta } from '@/types';

// ─── Tipos ────────────────────────────────────────────────────

export type TipoMovimiento    = 'INGRESO_OTRO' | 'EGRESO';
export type CategoriaMovimiento =
  | 'SERVICIOS_LUZ_AGUA' | 'INTERNET_PROVEEDOR'
  | 'PLANILLA_EMPLEADOS'  | 'ALQUILERES' | 'OTROS';
export type EstadoMovimiento  = 'PAGADO' | 'PENDIENTE_PAGO';

export interface EgresoIngreso {
  id:              string;
  tipo:            TipoMovimiento;
  categoria:       CategoriaMovimiento;
  monto:           number;
  fechaRegistro:   string;
  descripcion?:    string;
  esRecurrente:    boolean;
  diaVencimiento?: number;
  estado:          EstadoMovimiento;
  sectorId?:       string;
  plantillaId?:    string;
  createdAt:       string;
}

export interface CreateEgresoIngresoDto {
  tipo:            TipoMovimiento;
  categoria?:      CategoriaMovimiento;
  monto:           number;
  fechaRegistro:   string;
  descripcion?:    string;
  esRecurrente?:        boolean;
  diaVencimiento?:      number;
  sectorId?:            string;
  proyectoInversionId?: string;
}

export interface FiltrosOpex {
  tipo?:           TipoMovimiento;
  estado?:         EstadoMovimiento;
  fechaDesde?:     string;
  fechaHasta?:     string;
  soloRecurrentes?: boolean;
  page?:           number;
  limit?:          number;
}

export interface ResumenOpex {
  totalIngresosMes: number;
  totalEgresosMes:  number;
  pendientes:       number;
}

// ─── Labels ───────────────────────────────────────────────────

export const CATEGORIAS_LABELS: Record<CategoriaMovimiento, string> = {
  SERVICIOS_LUZ_AGUA: '💡 Servicios (Luz / Agua)',
  INTERNET_PROVEEDOR: '🌐 Internet de tránsito',
  PLANILLA_EMPLEADOS: '👥 Planillas',
  ALQUILERES:         '🏠 Alquileres',
  OTROS:              '• Otros',
};

// ─── API ──────────────────────────────────────────────────────

export const finanzasOpexApi = {

  list: async (filtros: FiltrosOpex = {}): Promise<PaginaRespuesta<EgresoIngreso>> => {
    const res  = await api.get('/finanzas/opex', { params: filtros });
    // backend: ApiResponse.ok(PaginatedResult) → res.data.data = { data:[], total, page, limit }
    const pag  = res.data?.data;
    const items: EgresoIngreso[] = Array.isArray(pag) ? pag : (pag?.data ?? []);
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

  getResumen: async (): Promise<ResumenOpex> => {
    const res = await api.get<ApiRespuesta<ResumenOpex>>('/finanzas/opex/resumen');
    return res.data.data;
  },

  getPendientes: async (): Promise<EgresoIngreso[]> => {
    const res = await api.get<ApiRespuesta<EgresoIngreso[]>>('/finanzas/opex/pendientes');
    return res.data.data ?? [];
  },

  create: async (dto: CreateEgresoIngresoDto): Promise<EgresoIngreso> => {
    const res = await api.post<ApiRespuesta<EgresoIngreso>>('/finanzas/opex', dto);
    return res.data.data;
  },

  marcarPagado: async (id: string): Promise<EgresoIngreso> => {
    const res = await api.patch<ApiRespuesta<EgresoIngreso>>(`/finanzas/opex/${id}/marcar-pagado`);
    return res.data.data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/finanzas/opex/${id}`);
  },
};
