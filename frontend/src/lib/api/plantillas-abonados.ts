import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

export interface FacturacionConfig {
  tipoComprobante?:  string;
  tipo:              string;
  diaPago:           string;
  crearFactura:      string;
  plantillaAvisoFactura?: string;
  tipoImpuesto:      string;
  diasGracia:        string;
  aplicarCorte:      string;
  aplicarMora:       boolean;
  montoMora:         number;
  aplicarReconexion: boolean;
  montoReconexion:   number;
  impuesto1:         number;
}

export interface NotificacionesConfig {
  avisoNuevaFactura:      string;
  avisoPantalla:          string;
  recordatoriosPago:      string;
  recordatorio1:          string;
  recordatorio2:          string;
  recordatorio3:          string;
  plantillaRecordatorio1?: string;
  plantillaRecordatorio2?: string;
  plantillaRecordatorio3?: string;
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
