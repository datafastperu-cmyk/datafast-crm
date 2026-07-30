import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

// Administración del Portal del Cliente (consumida por el OPERADOR desde el ERP).
// La API que consumirá el abonado vivirá bajo /portal/* con su propia autenticación.

export interface PortalConfig {
  id:                           string;
  empresaId:                    string;
  urlPortal:                    string | null;
  titulo:                       string;
  urlTestVelocidad:             string | null;
  tituloMenuPersonalizado:      string | null;
  contenidoMenuPersonalizado:   string | null;
  mostrarComprobantes:          boolean;
  mostrarSoporte:               boolean;
  mostrarInformarPago:          boolean;
  mostrarTestVelocidad:         boolean;
  mostrarNotificaciones:        boolean;
  mostrarWifi:                  boolean;
  mostrarDispositivos:          boolean;
  mostrarPlanes:                boolean;
  mostrarBanner:                boolean;
  mostrarMenuPersonalizado:     boolean;
  mostrarConsumo:               boolean;
  reportePagoDestinatarios:     string | null;
  reportePagoMedios:            string | null;
  logoUrl:                      string | null;
  colorPrimario:                string;
  tema:                         string;
}

// El backend devuelve advertencias junto a la configuración: problemas que no impiden
// guardar pero que dejarían el portal mal configurado (URL que no resuelve, sección
// habilitada sin datos detrás). Se muestran siempre, no solo al guardar.
export interface PortalConfigResultado {
  config:       PortalConfig;
  advertencias: string[];
}

export type UpdatePortalConfigDto = Partial<Omit<PortalConfig, 'id' | 'empresaId'>>;

export interface PortalBanner {
  id:            string;
  empresaId:     string;
  titulo:        string | null;
  imagenUrl:     string;
  enlaceUrl:     string | null;
  orden:         number;
  vigenteDesde:  string | null;
  vigenteHasta:  string | null;
  activo:        boolean;
}

export type UpsertPortalBannerDto = Omit<PortalBanner, 'id' | 'empresaId'>;

export const portalConfigApi = {
  get: async (): Promise<PortalConfigResultado> => {
    const { data } = await api.get<ApiRespuesta<PortalConfigResultado>>('/config/portal');
    return data.data;
  },

  update: async (dto: UpdatePortalConfigDto): Promise<PortalConfigResultado> => {
    const { data } = await api.put<ApiRespuesta<PortalConfigResultado>>('/config/portal', dto);
    return data.data;
  },

  listarBanners: async (): Promise<PortalBanner[]> => {
    const { data } = await api.get<ApiRespuesta<PortalBanner[]>>('/config/portal/banners');
    return data.data;
  },

  crearBanner: async (dto: UpsertPortalBannerDto): Promise<PortalBanner> => {
    const { data } = await api.post<ApiRespuesta<PortalBanner>>('/config/portal/banners', dto);
    return data.data;
  },

  actualizarBanner: async (id: string, dto: Partial<UpsertPortalBannerDto>): Promise<PortalBanner> => {
    const { data } = await api.put<ApiRespuesta<PortalBanner>>(`/config/portal/banners/${id}`, dto);
    return data.data;
  },

  eliminarBanner: async (id: string): Promise<void> => {
    await api.delete(`/config/portal/banners/${id}`);
  },
};
