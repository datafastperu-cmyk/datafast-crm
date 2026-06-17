import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

export interface MigrarWispFtthDto {
  contratoId:       string;
  clienteId:        string;
  oltId?:           string;
  oltDispositivoId?: string;
  serialNumber?:   string;
  ponPort:         string;
  perfilOlt:       string;
  vlanId:          number;
  vlanModo?:       'access' | 'trunk';
  routerFtthId:    string;
  segmentoFtthId:  string;
  ipManual?:       string;
  dhcpServer?:     string;
  omitirQueue?:    boolean;
  rollbackEnError?: boolean;
}

export interface PasoMigracion {
  paso:       number;
  nombre:     string;
  estado:     'ok' | 'error' | 'omitido' | 'revertido';
  detalle:    string;
  duracionMs?: number;
  datos?:     Record<string, any>;
}

export interface MigracionResultado {
  pasos:              PasoMigracion[];
  exitoso:            boolean;
  contratoId:         string;
  ipFtth?:            string;
  onuId?:             string;
  serialNumber?:      string;
  duracionTotalMs?:   number;
  mensajeFinal:       string;
  rollbackEjecutado?: boolean;
  pasosFallidos?:     number[];
}

export interface MigrarFtthWispDto {
  contratoId:      string;
  clienteId:       string;
  routerWispId:    string;
  segmentoWispId:  string;
  ipManual?:       string;
  antenaApId?:     string;
  rollbackEnError?: boolean;
  motivo?:         string;
}

export const migracionApi = {
  migrarWispAFtth: async (dto: MigrarWispFtthDto): Promise<MigracionResultado> => {
    const res = await api.post<ApiRespuesta<MigracionResultado>>('/migracion/wisp-a-ftth', dto);
    return res.data.data;
  },

  migrarFtthAWisp: async (dto: MigrarFtthWispDto): Promise<MigracionResultado> => {
    const res = await api.post<ApiRespuesta<MigracionResultado>>('/migracion/ftth-a-wisp', dto);
    return res.data.data;
  },
};
