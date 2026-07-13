import api from '@/lib/api';
import type { Router } from '@/lib/api/mikrotik';
import type { OltDispositivo } from '@/lib/api/olt-nativo';

// ─── Types ────────────────────────────────────────────────────

export interface Site {
  id:          string;
  empresaId:   string;
  nombre:      string;
  descripcion?: string | null;
  ubicacion?:  string | null;
  latitud?:    number | null;
  longitud?:   number | null;
  zonaId?:     string | null;
  routerId?:   string | null;
  activo:      boolean;
  createdAt:   string;
  updatedAt:   string;
}

export interface CreateSiteDto {
  nombre:       string;
  descripcion?: string;
  ubicacion?:   string;
  latitud?:     number;
  longitud?:    number;
  zonaId?:      string;
  routerId?:    string;
}

export interface UpdateSiteDto extends Partial<CreateSiteDto> {}

export interface VpnClienteResumen {
  id:              string;
  nombre:          string;
  estado:          'pendiente' | 'conectado' | 'desconectado' | 'revocado';
  vpnIp?:          string | null;
  ultimoHandshake?: string | null;
}

export interface SiteDetalle {
  site:   Site;
  router: Router | null;
  vpn:    VpnClienteResumen | null;
  olts:   OltDispositivo[];
}

// ─── Client ───────────────────────────────────────────────────

export const sitesApi = {
  listar: async (): Promise<Site[]> => {
    const { data } = await api.get('/sites');
    return data.data;
  },

  detalle: async (id: string): Promise<SiteDetalle> => {
    const { data } = await api.get(`/sites/${id}`);
    return data.data;
  },

  crear: async (dto: CreateSiteDto): Promise<Site> => {
    const { data } = await api.post('/sites', dto);
    return data.data;
  },

  actualizar: async (id: string, dto: UpdateSiteDto): Promise<Site> => {
    const { data } = await api.patch(`/sites/${id}`, dto);
    return data.data;
  },

  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/sites/${id}`);
  },
};
