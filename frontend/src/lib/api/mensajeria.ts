import api from '@/lib/api';

export interface CuotaDto {
  limiteDiario: number;
  usado:        number;
  restante:     number;
}

export interface MonitorDto {
  encolados:  number;
  enviados:   number;
  fallidos:   number;
  entregados: number;
}

export interface IniciarCampanaDto {
  tipo:         string;
  templateId?:  string;
  sectorId?:    string;
  routerId?:    string;
  variables?:   Record<string, string>;
}

export interface IniciarCampanaResult {
  total:         number;
  encolados:     number;
  cuotaRestante: number;
}

export interface VaciarColaResult {
  eliminados: number;
}

export const mensajeriaApi = {
  cuota: async (): Promise<CuotaDto> => {
    const { data } = await api.get('/mensajeria/cuota');
    return data.data;
  },

  monitor: async (): Promise<MonitorDto> => {
    const { data } = await api.get('/mensajeria/monitor');
    return data.data;
  },

  iniciarCampana: async (dto: IniciarCampanaDto): Promise<IniciarCampanaResult> => {
    const { data } = await api.post('/mensajeria/campanas', dto);
    return data.data;
  },

  vaciarCola: async (): Promise<VaciarColaResult> => {
    const { data } = await api.delete('/mensajeria/cola');
    return data.data;
  },
};
