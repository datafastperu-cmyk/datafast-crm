import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

// ─── Empresa ──────────────────────────────────────────────────
export interface Empresa {
  id:                string;
  razonSocial:       string;
  ruc:               string;
  direccion?:        string;
  telefono?:         string;
  email?:            string;
  logoUrl?:          string;
  websiteUrl?:       string;
  serieBoleta:       string;
  serieFactura:      string;
  igvRate:           number;
  diasGraciaCorte:   number;
  diaFacturacion:    number;
  notifWhatsappVencimiento: boolean;
  notifWhatsappCorte:       boolean;
  estado:            string;
}

export interface UpdateEmpresaDto extends Partial<Omit<Empresa, 'id' | 'estado'>> {}

// ─── Usuario ──────────────────────────────────────────────────
export interface UsuarioAdmin {
  id:            string;
  nombreCompleto: string;
  email:         string;
  roles:         string[];
  activo:        boolean;
  ultimoAcceso?: string;
  createdAt:     string;
}

export interface CreateUsuarioDto {
  nombreCompleto: string;
  email:          string;
  password:       string;
  roles:          string[];
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword:     string;
  confirmPassword: string;
}

// ─── Reportes ─────────────────────────────────────────────────
export interface FiltrosReporte {
  mes?:       number;
  anio?:      number;
  fechaDesde?: string;
  fechaHasta?: string;
  formato?:   'json' | 'csv' | 'xlsx';
}

export interface ReporteCobranza {
  periodo:         string;
  totalFacturado:  number;
  totalCobrado:    number;
  totalPendiente:  number;
  tasaCobranza:    number;
  porMetodo:       Record<string, number>;
  topClientes:     Array<{ nombre: string; monto: number }>;
  evolucionDiaria: Array<{ fecha: string; cobrado: number; facturas: number }>;
}

export interface ReporteClientes {
  totalActivos:        number;
  totalSuspendidos:    number;
  totalBaja:           number;
  nuevosMes:           number;
  bajasMes:            number;
  porServicio:         Record<string, number>;
  porZona:             Array<{ zona: string; total: number }>;
  churRate:            number;
}

export interface ReporteRed {
  totalNodos:          number;
  uptimePromedio:      number;
  alertasCriticas:     number;
  incidentes:          number;
  topNodosLatencia:    Array<{ nombre: string; latenciaAvg: number }>;
  disponibilidad:      Array<{ fecha: string; pct: number }>;
}

// ─── Config API ───────────────────────────────────────────────
export const configApi = {

  getEmpresa: async (): Promise<Empresa> => {
    const res = await api.get<ApiRespuesta<Empresa>>('/config/empresa');
    return res.data.data;
  },

  updateEmpresa: async (dto: UpdateEmpresaDto): Promise<Empresa> => {
    const res = await api.put<ApiRespuesta<Empresa>>('/config/empresa', dto);
    return res.data.data;
  },

  uploadLogo: async (file: File): Promise<{ logoUrl: string }> => {
    const form = new FormData();
    form.append('logo', file);
    const res = await api.post<ApiRespuesta<{ logoUrl: string }>>(
      '/config/empresa/logo',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  // Usuarios
  getUsuarios: async (): Promise<UsuarioAdmin[]> => {
    const res = await api.get<ApiRespuesta<UsuarioAdmin[]>>('/auth/usuarios');
    return res.data.data ?? [];
  },

  createUsuario: async (dto: CreateUsuarioDto): Promise<UsuarioAdmin> => {
    const res = await api.post<ApiRespuesta<UsuarioAdmin>>('/auth/registro', dto);
    return res.data.data;
  },

  toggleUsuario: async (id: string, activo: boolean): Promise<void> => {
    await api.patch(`/auth/usuarios/${id}/estado`, { activo });
  },

  changePassword: async (dto: ChangePasswordDto): Promise<void> => {
    await api.patch('/auth/change-password', dto);
  },

  getMe: async () => {
    const res = await api.get<ApiRespuesta>('/auth/me');
    return res.data.data;
  },

  getRoles: async (): Promise<string[]> => {
    const res = await api.get<ApiRespuesta>('/auth/roles');
    return res.data.data ?? ['Administrador', 'Supervisor', 'Cajero', 'Técnico'];
  },
};

// ─── Reportes API ─────────────────────────────────────────────
export const reportesApi = {

  getResumenGeneral: async (): Promise<{
    clientes: any; contratos: any; facturacion: any; red: any;
  }> => {
    const res = await api.get<ApiRespuesta>('/reportes/resumen');
    return res.data.data;
  },

  getCobranza: async (filtros: FiltrosReporte): Promise<ReporteCobranza> => {
    const res = await api.get<ApiRespuesta<ReporteCobranza>>('/reportes/cobranza', {
      params: filtros,
    });
    return res.data.data;
  },

  getClientes: async (filtros: FiltrosReporte): Promise<ReporteClientes> => {
    const res = await api.get<ApiRespuesta<ReporteClientes>>('/reportes/clientes', {
      params: filtros,
    });
    return res.data.data;
  },

  getRed: async (filtros: FiltrosReporte): Promise<ReporteRed> => {
    const res = await api.get<ApiRespuesta<ReporteRed>>('/reportes/red', { params: filtros });
    return res.data.data;
  },

  exportar: async (tipo: string, filtros: FiltrosReporte): Promise<Blob> => {
    const res = await api.get(`/reportes/${tipo}/exportar`, {
      params:       { ...filtros, formato: filtros.formato || 'csv' },
      responseType: 'blob',
    });
    return res.data;
  },
};
