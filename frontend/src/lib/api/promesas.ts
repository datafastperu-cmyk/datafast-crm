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
};
