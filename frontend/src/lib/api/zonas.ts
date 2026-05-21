import api from '@/lib/api';

export interface Zona {
  id:     string;
  nombre: string;
  activo: boolean;
}

export const zonasApi = {
  list: async (): Promise<Zona[]> => {
    const res = await api.get<{ data: Zona[] }>('/zonas');
    return res.data.data;
  },
};
