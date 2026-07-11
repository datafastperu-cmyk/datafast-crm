import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

export interface XuiBouquet {
  id:   number;
  name: string;
}

export type EstadoSyncXuiLine = 'pendiente_creacion' | 'sincronizado' | 'pendiente_eliminacion' | 'error';

export interface XuiLine {
  id:                 string;
  contratoId:         string;
  clienteId:          string;
  usuario:            string;
  sufijo:             number;
  bouquetIds:         number[];
  maxConexiones:      number;
  activo:             boolean;
  estadoSync:         EstadoSyncXuiLine;
  ultimoErrorSync:    string | null;
  canalActual:        string | null;
  conectado:          boolean;
  ultimaActividadEn:  string | null;
  createdAt:          string;
}

export interface XuiChannelStatus {
  channelId: number;
  nombre:    string;
  bouquetId: number;
  online:    boolean;
}

export interface EditarXuiLineDto {
  bouquetIds?:            number[];
  maxConexiones?:         number;
  regenerarCredenciales?: boolean;
}

export type XuiEstadoConexionServidor = 'ok' | 'error' | 'sin_probar';

export interface XuiServidor {
  id:                     string;
  nombre:                 string;
  descripcion:            string | null;
  apiUrl:                 string;
  latitud:                number | null;
  longitud:               number | null;
  estadoConexion:         XuiEstadoConexionServidor;
  ultimoErrorConexion:    string | null;
  ultimaConexionEn:       string | null;
  totalLineas:            number;
  totalBouquets:          number;
  totalCanales:           number;
  catalogoSincronizadoEn: string | null;
}

export interface ServidorFormDto {
  nombre:       string;
  descripcion?: string;
  apiUrl:       string;
  apiKey:       string;
  latitud?:     number;
  longitud?:    number;
}

export const xuiApi = {
  health: async () => {
    const res = await api.get<ApiRespuesta<{ conectado: boolean; mensaje: string }>>('/xui/health');
    return res.data.data;
  },

  listarBouquets: async (): Promise<XuiBouquet[]> => {
    const res = await api.get<ApiRespuesta<XuiBouquet[]>>('/xui/bouquets');
    return res.data.data;
  },

  listarPorCliente: async (clienteId: string): Promise<XuiLine[]> => {
    const res = await api.get<ApiRespuesta<XuiLine[]>>('/xui/lines', { params: { clienteId } });
    return res.data.data;
  },

  listar: async (filtros?: { clienteId?: string; contratoId?: string; q?: string }): Promise<XuiLine[]> => {
    const res = await api.get<ApiRespuesta<XuiLine[]>>('/xui/lines', { params: filtros });
    return res.data.data;
  },

  editarLine: async (id: string, dto: EditarXuiLineDto): Promise<XuiLine> => {
    const res = await api.put<ApiRespuesta<XuiLine>>(`/xui/lines/${id}`, dto);
    return res.data.data;
  },

  canalesStatus: async (): Promise<{ canales: XuiChannelStatus[]; actualizadoEn: string | null }> => {
    const res = await api.get<ApiRespuesta<{ canales: XuiChannelStatus[]; actualizadoEn: string | null }>>('/xui/channels/status');
    return res.data.data;
  },

  obtenerServidor: async (): Promise<XuiServidor | null> => {
    const res = await api.get<ApiRespuesta<XuiServidor | null>>('/xui/servidor');
    return res.data.data;
  },

  probarServidor: async (dto: { apiUrl: string; apiKey: string }): Promise<{ conectado: boolean; mensaje: string }> => {
    const res = await api.post<ApiRespuesta<{ conectado: boolean; mensaje: string }>>('/xui/servidor/probar', dto);
    return res.data.data;
  },

  crearServidor: async (dto: ServidorFormDto): Promise<XuiServidor> => {
    const res = await api.post<ApiRespuesta<XuiServidor>>('/xui/servidor', dto);
    return res.data.data;
  },

  editarServidor: async (id: string, dto: ServidorFormDto): Promise<XuiServidor> => {
    const res = await api.put<ApiRespuesta<XuiServidor>>(`/xui/servidor/${id}`, dto);
    return res.data.data;
  },
};
