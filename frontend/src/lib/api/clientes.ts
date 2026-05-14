import api from '@/lib/api';
import type { Cliente, PaginaRespuesta, ApiRespuesta } from '@/types';

export interface FiltrosCliente {
  search?:      string;
  estado?:      string;
  tipoServicio?: string;
  page?:        number;
  limit?:       number;
  orderBy?:     string;
  order?:       'ASC' | 'DESC';
}

export interface CreateClienteDto {
  tipoDocumento:    string;
  numeroDocumento:  string;
  nombres:          string;
  apellidoPaterno:  string;
  apellidoMaterno?: string;
  email?:           string;
  telefono:         string;
  telefonoAlt?:     string;
  whatsapp?:        string;
  direccion:        string;
  referencia?:      string;
  departamento?:    string;
  provincia?:       string;
  distrito?:        string;
  latitud?:         number;
  longitud?:        number;
  tipoServicio?:    string;
  esEmpresa?:       boolean;
  rucEmpresa?:      string;
  razonSocial?:     string;
  notasInternas?:   string;
}

export interface ReniecDatos {
  nombres:         string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  dni:             string;
  sexo?:           string;
  fechaNacimiento?: string;
  estadoCivil?:    string;
  departamento?:   string;
  provincia?:      string;
  distrito?:       string;
  direccion?:      string;
  ubigeo?:         string;
}

// ─── API calls ────────────────────────────────────────────────
export const clientesApi = {

  list: async (filtros: FiltrosCliente = {}): Promise<PaginaRespuesta<Cliente>> => {
    const res = await api.get<ApiRespuesta>('/clientes', { params: filtros });
    return { data: res.data.data, meta: res.data.meta?.meta };
  },

  getById: async (id: string): Promise<Cliente> => {
    const res = await api.get<ApiRespuesta<Cliente>>(`/clientes/${id}`);
    return res.data.data;
  },

  create: async (dto: CreateClienteDto): Promise<Cliente> => {
    const res = await api.post<ApiRespuesta<Cliente>>('/clientes', dto);
    return res.data.data;
  },

  update: async (id: string, dto: Partial<CreateClienteDto>): Promise<Cliente> => {
    const res = await api.put<ApiRespuesta<Cliente>>(`/clientes/${id}`, dto);
    return res.data.data;
  },

  cambiarEstado: async (id: string, estado: string, motivo?: string): Promise<Cliente> => {
    const res = await api.patch<ApiRespuesta<Cliente>>(`/clientes/${id}/estado`, {
      estado, motivo,
    });
    return res.data.data;
  },

  consultarReniec: async (dni: string): Promise<ReniecDatos> => {
    const res = await api.post<ApiRespuesta<ReniecDatos>>('/clientes/reniec', { dni });
    return res.data.data;
  },

  exportar: async (filtros: FiltrosCliente, formato: 'csv' | 'xlsx') => {
    const res = await api.get('/clientes/exportar', {
      params:       { ...filtros, formato },
      responseType: 'blob',
    });
    return res.data;
  },

  getStats: async (): Promise<Record<string, number>> => {
    const res = await api.get<ApiRespuesta>('/clientes/stats');
    return res.data.data;
  },

  getContratos: async (clienteId: string) => {
    const res = await api.get<ApiRespuesta>(`/clientes/${clienteId}/contratos`);
    return res.data.data;
  },

  getHistorial: async (clienteId: string) => {
    const res = await api.get<ApiRespuesta>(`/clientes/${clienteId}/historial`);
    return res.data.data;
  },
};
