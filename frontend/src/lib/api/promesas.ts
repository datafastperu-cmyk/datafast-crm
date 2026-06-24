import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

export interface CrearPromesaDto {
  contratoId:       string;
  fechaVencimiento: string;   // 'YYYY-MM-DD'
  motivo:           string;
}

export interface PromesaResultado {
  contratoId:      string;
  prorrogaHasta:   string;
  enProrroga:      boolean;
  mikrotikAplicado: boolean;
}

export interface PromesaStats {
  activas:   number;
  vencenHoy: number;
  vencidas:  number;
  cumplidas: number;
}

export interface PromesaRow {
  id:                 string;
  contratoId:         string;
  estado:             string;
  fechaVencimiento:   string;
  montoPrometido:     string | null;
  deudaAlCrear:       string;
  mikrotikAplicado:   boolean;
  mikrotikReintentos: number;
  motivo:             string | null;
  creadaEn:           string;
  resueltaEn:         string | null;
  clienteNombre:      string;
  clienteTelefono:    string | null;
  numeroContrato:     string;
  ipAsignada:         string | null;
  routerNombre:       string | null;
}

export interface ListarPromesasResult {
  data: PromesaRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const promesasApi = {
  crear: async (dto: CrearPromesaDto): Promise<PromesaResultado> => {
    const res = await api.patch<ApiRespuesta<PromesaResultado>>(
      `/contratos/${dto.contratoId}/prorroga`,
      { prorrogaHasta: dto.fechaVencimiento, motivo: dto.motivo },
    );
    return {
      contratoId:      dto.contratoId,
      prorrogaHasta:   dto.fechaVencimiento,
      enProrroga:      true,
      mikrotikAplicado: false,
      ...res.data.data,
    };
  },

  stats: async (): Promise<PromesaStats> => {
    const res = await api.get<ApiRespuesta<PromesaStats>>('/promesas-pago/stats');
    return res.data.data;
  },

  listar: async (filtros?: { estado?: string; page?: number; limit?: number }): Promise<ListarPromesasResult> => {
    const params: Record<string, string | number> = {};
    if (filtros?.estado) params.estado = filtros.estado;
    if (filtros?.page)   params.page   = filtros.page;
    if (filtros?.limit)  params.limit  = filtros.limit;
    const res = await api.get<ApiRespuesta<ListarPromesasResult>>('/promesas-pago', { params });
    return res.data.data;
  },

  cancelar: async (id: string, motivo?: string): Promise<void> => {
    await api.patch(`/promesas-pago/${id}/cancelar`, { motivo: motivo ?? '' });
  },
};
