import api from '@/lib/api';
import type { ApiRespuesta, Usuario } from '@/types';

// ─── Empresa ──────────────────────────────────────────────────
export interface Empresa {
  id:                string;
  razonSocial:       string;
  ruc:               string;
  direccion?:        string;
  whatsappCorporativo?:   string;
  telefonoInformativo?:   string;
  email?:                 string;
  logoUrl?:          string;
  websiteUrl?:       string;
  serieBoleta:       string;
  serieFactura:      string;
  igvRate:           number;
  diasGraciaCorte:   number;
  diaFacturacion:    number;
  moneda:            string;
  tipoComprobanteDefault: string;
  dominio?:          string;
  pais?:             string;
  zonaHoraria:       string;
  estado:            string;
}

export interface FacturacionResumen {
  ultimaBoleta:        number;
  serieBoleta:         string;
  ultimaFactura:       number;
  serieFactura:        string;
  ultimoRecibo:        number;
  serieRecibo:         string;
  totalEmitidas:       number;
  totalVencidas:       number;
  montoDeudaPendiente: number;
}

export interface UpdateEmpresaDto extends Partial<Omit<Empresa, 'id' | 'estado'>> {}

export interface SslStatus {
  hasCert:    boolean;
  expiresAt:  string | null;
  domain:     string | null;
  cloudflare: boolean;
  serverIp:   string;
  domainIp:   string | null;
  dnsOk:      boolean;
}

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

  // Usuarios — viven en /usuarios, no bajo /auth. Con las rutas anteriores
  // (`/auth/usuarios`, `/auth/registro`) el backend devolvía 404 y la pestaña de
  // Personal no podía listar ni crear usuarios.
  getUsuarios: async (): Promise<UsuarioAdmin[]> => {
    const res = await api.get<ApiRespuesta<UsuarioAdmin[]>>('/usuarios');
    return res.data.data ?? [];
  },

  createUsuario: async (dto: CreateUsuarioDto): Promise<UsuarioAdmin> => {
    const res = await api.post<ApiRespuesta<UsuarioAdmin>>('/usuarios', dto);
    return res.data.data;
  },

  // El desajuste no era solo de ruta: el backend espera `{ estado }` con un enum
  // ('activo' | 'inactivo' | 'bloqueado'), no `{ activo: boolean }`. Enviar el booleano
  // habría fallado igual con un 400 de validación tras corregir la URL.
  toggleUsuario: async (id: string, activo: boolean): Promise<void> => {
    await api.patch(`/usuarios/${id}/estado`, { estado: activo ? 'activo' : 'inactivo' });
  },

  changePassword: async (dto: ChangePasswordDto): Promise<void> => {
    await api.patch('/auth/change-password', dto);
  },

  getMe: async (): Promise<Usuario> => {
    const res = await api.get<ApiRespuesta<Usuario>>('/auth/me');
    return res.data.data;
  },

  // /roles, no /auth/roles. El backend devuelve los roles con sus permisos; aquí solo
  // se necesitan los nombres, así que se proyectan. El fallback se conserva: si la
  // llamada falla, la UI sigue ofreciendo los roles base en vez de un desplegable vacío.
  getRoles: async (): Promise<string[]> => {
    const res = await api.get<ApiRespuesta<Array<{ nombre: string } | string>>>('/roles');
    const roles = res.data.data ?? [];
    const nombres = roles
      .map((r) => (typeof r === 'string' ? r : r?.nombre))
      .filter((n): n is string => Boolean(n));
    return nombres.length ? nombres : ['Administrador', 'Supervisor', 'Cajero', 'Técnico'];
  },

  getFacturacionResumen: async (): Promise<FacturacionResumen> => {
    const res = await api.get<ApiRespuesta<FacturacionResumen>>('/config/facturacion-resumen');
    return res.data.data;
  },
};

// ─── Reportes API ─────────────────────────────────────────────
export const reportesApi = {

  getResumenGeneral: async (): Promise<Record<string, Record<string, number>>> => {
    const res = await api.get<ApiRespuesta<Record<string, Record<string, number>>>>('/reportes/resumen');
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

  // OJO: el backend solo expone `cobranza/exportar` y `clientes/exportar`. La pestaña
  // "red" llama a `/reportes/red/exportar`, que NO existe → 404 al pulsar Exportar.
  // Se marca aquí porque el verificador no puede resolver `${tipo}` estáticamente: para
  // él la ruta es siempre `/reportes/:p/exportar` y no distingue qué valores son válidos.
  exportar: async (tipo: string, filtros: FiltrosReporte): Promise<Blob> => {
    const res = await api.get(`/reportes/${tipo}/exportar`, {
      params:       { ...filtros, formato: filtros.formato || 'csv' },
      responseType: 'blob',
    });
    return res.data;
  },
};
