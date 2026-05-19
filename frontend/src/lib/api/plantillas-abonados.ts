import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

export interface FacturacionConfig {
  tipo:              string;
  diaPago:           string;
  crearFactura:      string;
  tipoImpuesto:      string;
  diasGracia:        string;
  aplicarCorte:      string;
  aplicarMora:       boolean;
  aplicarReconexion: boolean;
  impuesto1:         number;
  impuesto2:         number;
  impuesto3:         number;
}

export interface NotificacionesConfig {
  avisoNuevaFactura: string;
  avisoPantalla:     string;
  recordatoriosPago: string;
  recordatorio1:     string;
  recordatorio2:     string;
  recordatorio3:     string;
}

export interface PlantillaAbonado {
  id:             string;
  nombre:         string;
  facturacion:    FacturacionConfig;
  notificaciones: NotificacionesConfig;
  esDefault:      boolean;
  createdAt:      string;
  updatedAt:      string;
}

export interface SavePlantillaDto {
  nombre:         string;
  facturacion:    FacturacionConfig;
  notificaciones: NotificacionesConfig;
}

export const plantillasAbonadosApi = {
  list: async (): Promise<PlantillaAbonado[]> => {
    const res = await api.get<ApiRespuesta<PlantillaAbonado[]>>('/plantillas/abonados');
    return res.data.data ?? [];
  },

  create: async (dto: SavePlantillaDto): Promise<PlantillaAbonado> => {
    const res = await api.post<ApiRespuesta<PlantillaAbonado>>('/plantillas/abonados', dto);
    return res.data.data;
  },

  update: async (id: string, dto: SavePlantillaDto): Promise<PlantillaAbonado> => {
    const res = await api.put<ApiRespuesta<PlantillaAbonado>>(`/plantillas/abonados/${id}`, dto);
    return res.data.data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/plantillas/abonados/${id}`);
  },
};
