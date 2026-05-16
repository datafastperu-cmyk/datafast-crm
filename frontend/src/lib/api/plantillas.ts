import api from '@/lib/api';

export type TipoPlantilla = 'whatsapp' | 'email' | 'documento';

export interface PlantillaDto {
  id?: string;
  tipo: TipoPlantilla;
  codigo: string;
  nombre: string;
  contenido: string;
  activo: boolean;
  esDefault: boolean;
}

export const plantillasApi = {
  listar: async (tipo: TipoPlantilla): Promise<PlantillaDto[]> => {
    const { data } = await api.get('/plantillas', { params: { tipo } });
    return data.data;
  },

  guardar: async (tipo: TipoPlantilla, codigo: string, contenido: string): Promise<PlantillaDto> => {
    const { data } = await api.put(`/plantillas/${tipo}/${codigo}`, { contenido });
    return data.data;
  },

  restaurar: async (tipo: TipoPlantilla, codigo: string): Promise<PlantillaDto> => {
    const { data } = await api.post(`/plantillas/${tipo}/${codigo}/restaurar`);
    return data.data;
  },
};
