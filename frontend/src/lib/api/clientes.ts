import api from '@/lib/api';
import type { Cliente, Contrato, HistorialEntry, PaginaRespuesta, PaginaMeta, ApiRespuesta } from '@/types';

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
  tipoDocumento?:   string;
  numeroDocumento:  string;
  nombres:          string;
  apellidoPaterno:  string;
  apellidoMaterno?: string;
  email?:           string;
  telefono?:        string;
  zonaId?:          string;
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
  usuarioPortal?:   string;
  passwordPortal?:  string;
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
    const res = await api.get<ApiRespuesta<Cliente[]>>('/clientes', { params: filtros });
    return { data: res.data.data ?? [], meta: res.data.meta?.['meta'] as PaginaMeta };
  },

  getById: async (id: string): Promise<Cliente> => {
    const res = await api.get<ApiRespuesta<Cliente>>(`/clientes/${id}`);
    return res.data.data;
  },

  create: async (dto: CreateClienteDto): Promise<Cliente> => {
    const res = await api.post<ApiRespuesta<Cliente>>('/clientes', dto);
    return res.data.data;
  },

  update: async (id: string, dto: Partial<CreateClienteDto> & { version?: number }): Promise<Cliente> => {
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
    const res = await api.get<ApiRespuesta<Record<string, number>>>('/clientes/resumen');
    return res.data.data;
  },

  getContratos: async (clienteId: string): Promise<Contrato[]> => {
    const res = await api.get<ApiRespuesta<Contrato[]>>(`/clientes/${clienteId}/contratos`);
    return res.data.data ?? [];
  },

  getHistorial: async (clienteId: string): Promise<HistorialEntry[]> => {
    const res = await api.get<ApiRespuesta<HistorialEntry[]>>(`/clientes/${clienteId}/historial`);
    return res.data.data ?? [];
  },

  bulkAction: async (
    ids: string[],
    action: 'suspender' | 'reactivar' | 'baja_temporal' | 'marcar_moroso',
    motivo?: string,
  ): Promise<{ ok: number; errors: number; total: number }> => {
    const res = await api.post<ApiRespuesta<{ ok: number; errors: number; total: number }>>('/clientes/bulk-action', { ids, action, motivo });
    return res.data.data;
  },

  getFacturacionConfig: async (clienteId: string): Promise<{ facturacion: Record<string, any> | null; notificaciones: Record<string, any> | null }> => {
    const res = await api.get<ApiRespuesta<{ facturacion: Record<string, any> | null; notificaciones: Record<string, any> | null }>>(`/clientes/${clienteId}/facturacion-config`);
    return res.data.data;
  },

  saveFacturacionConfig: async (
    clienteId: string,
    facturacion: Record<string, any>,
    notificaciones: Record<string, any>,
  ): Promise<void> => {
    await api.put(`/clientes/${clienteId}/facturacion-config`, { facturacion, notificaciones });
  },

  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/clientes/${id}`);
  },

  onboarding: async (dto: {
    cliente: CreateClienteDto;
    contrato?: {
      planId?: string;
      routerId?: string;
      segmentoId?: string;
      nodoId?: string;
      antenaApId?: string;
      ipManual?: string;
      usuarioPppoe?: string;
      passwordPppoePlain?: string;
      fechaInicio?: string;
      diaFacturacion?: number;
      descuentoPct?: number;
      macAddress?: string;
      excluirFirewall?: boolean;
      routes?: string;
      ipAdministracion?: string;
      tipoAntena?: string;
      cajaNap?: string;
      puertoNap?: string;
      direccionInstalacion?: string;
      latitudInstalacion?: number;
      longitudInstalacion?: number;
      notasInstalacion?: string;
      notasTecnicas?: string;
    };
    facturacion?: Record<string, any>;
    notificaciones?: Record<string, any>;
  }): Promise<{ cliente: any; contrato: any | null }> => {
    const res = await api.post<ApiRespuesta<{ cliente: any; contrato: any | null }>>('/clientes/onboarding', dto);
    return res.data.data;
  },
};
