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

// Solicitudes de cambio de plan enviadas desde el portal. Resolver NO aplica el cambio:
// registra el veredicto. El cambio se ejecuta por el flujo de negocio existente (queue
// del MikroTik, precio del contrato, prorrateo de la factura en curso).
export interface SolicitudPlan {
  id:               string;
  estado:           'pendiente' | 'aprobada' | 'rechazada' | 'aplicada' | 'cancelada';
  numeroContrato:   string;
  clienteNombre:    string;
  clienteWhatsapp:  string | null;
  planOrigen:       string;
  planDestino:      string;
  precio_origen:    string;
  precio_destino:   string;
  deudaTotal:       string;
  tipoPago:         string | null;
  nota_cliente:     string | null;
  motivo_resolucion: string | null;
  created_at:       string;
  resuelta_en:      string | null;
}

export const portalConfigApi = {
  get: async (): Promise<PortalConfigResultado> => {
    const { data } = await api.get<ApiRespuesta<PortalConfigResultado>>('/config/portal');
    return data.data;
  },

  update: async (dto: UpdatePortalConfigDto): Promise<PortalConfigResultado> => {
    const { data } = await api.put<ApiRespuesta<PortalConfigResultado>>('/config/portal', dto);
    return data.data;
  },

  listarSolicitudesPlan: async (estado?: string): Promise<SolicitudPlan[]> => {
    const { data } = await api.get<ApiRespuesta<SolicitudPlan[]>>('/config/portal/solicitudes-plan', {
      params: estado ? { estado } : undefined,
    });
    return data.data;
  },

  resolverSolicitudPlan: async (
    id: string,
    dto: { decision: 'aprobada' | 'rechazada' | 'aplicada'; motivo?: string },
  ): Promise<void> => {
    await api.post(`/config/portal/solicitudes-plan/${id}/resolver`, dto);
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
