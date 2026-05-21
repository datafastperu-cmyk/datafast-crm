import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

// ── Tipos ────────────────────────────────────────────────────
export interface UsuarioDetalle {
  id:             string;
  nombres:        string;
  apellidos:      string;
  nombreCompleto: string;
  email:          string;
  telefono?:      string;
  fotoUrl?:       string;
  estado:         'activo' | 'inactivo' | 'bloqueado' | 'pendiente_verificacion';
  emailVerificado: boolean;
  roles:          string[];
  ultimoAcceso?:  string;
  createdAt:      string;
}

export interface CreateUsuarioPayload {
  nombres?:   string;
  apellidos?:  string;
  email:      string;
  password:   string;
  telefono?:  string;
  roles:      string[];
}

export interface UpdateUsuarioPayload {
  nombres?:   string;
  apellidos?: string;
  email?:     string;
  telefono?:  string;
  roles?:     string[];
}

export interface RolDetalle {
  id:           string;
  nombre:       string;
  descripcion?: string;
  esSistema:    boolean;
  permisos:     string[];
  totalPermisos: number;
}

export interface GrupoPermisos {
  modulo:   string;
  permisos: { id: string; codigo: string; nombre: string; descripcion?: string }[];
}

export interface AuditLog {
  id:           string;
  usuarioEmail?: string;
  accion:       string;
  modulo:       string;
  descripcion?: string;
  ipAddress?:   string;
  createdAt:    string;
}

// ── Usuarios API ─────────────────────────────────────────────
export const usuariosApi = {
  list: async (): Promise<UsuarioDetalle[]> => {
    const res = await api.get<ApiRespuesta<UsuarioDetalle[]>>('/usuarios');
    return res.data.data ?? [];
  },

  get: async (id: string): Promise<UsuarioDetalle> => {
    const res = await api.get<ApiRespuesta<UsuarioDetalle>>(`/usuarios/${id}`);
    return res.data.data;
  },

  create: async (dto: CreateUsuarioPayload): Promise<UsuarioDetalle> => {
    const res = await api.post<ApiRespuesta<UsuarioDetalle>>('/usuarios', dto);
    return res.data.data;
  },

  update: async (id: string, dto: UpdateUsuarioPayload): Promise<UsuarioDetalle> => {
    const res = await api.put<ApiRespuesta<UsuarioDetalle>>(`/usuarios/${id}`, dto);
    return res.data.data;
  },

  cambiarEstado: async (id: string, estado: string): Promise<void> => {
    await api.patch(`/usuarios/${id}/estado`, { estado });
  },

  asignarRoles: async (id: string, roles: string[]): Promise<UsuarioDetalle> => {
    const res = await api.patch<ApiRespuesta<UsuarioDetalle>>(`/usuarios/${id}/roles`, { roles });
    return res.data.data;
  },

  resetPassword: async (id: string, nuevaPassword: string): Promise<void> => {
    await api.patch(`/usuarios/${id}/reset-password`, { nuevaPassword });
  },

  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/usuarios/${id}`);
  },
};

// ── Roles API ────────────────────────────────────────────────
export const rolesApi = {
  list: async (): Promise<RolDetalle[]> => {
    const res = await api.get<ApiRespuesta<RolDetalle[]>>('/roles');
    return res.data.data ?? [];
  },

  create: async (dto: { nombre: string; descripcion?: string; permisosCodigos?: string[] }): Promise<RolDetalle> => {
    const res = await api.post<ApiRespuesta<RolDetalle>>('/roles', dto);
    return res.data.data;
  },

  update: async (id: string, dto: { nombre?: string; descripcion?: string; permisosCodigos?: string[] }): Promise<RolDetalle> => {
    const res = await api.put<ApiRespuesta<RolDetalle>>(`/roles/${id}`, dto);
    return res.data.data;
  },

  asignarPermisos: async (id: string, permisosCodigos: string[]): Promise<void> => {
    await api.patch(`/roles/${id}/permisos`, { permisosCodigos });
  },

  clonar: async (id: string, nuevoNombre: string): Promise<RolDetalle> => {
    const res = await api.post<ApiRespuesta<RolDetalle>>(`/roles/${id}/clonar`, { nuevoNombre });
    return res.data.data;
  },

  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/roles/${id}`);
  },
};

// ── Permisos API ─────────────────────────────────────────────
export const permisosApi = {
  list: async (): Promise<GrupoPermisos[]> => {
    const res = await api.get<ApiRespuesta<GrupoPermisos[]>>('/permisos');
    return res.data.data ?? [];
  },
};

// ── Logs API ─────────────────────────────────────────────────
export const logsPersonalApi = {
  list: async (limit?: number): Promise<AuditLog[]> => {
    const res = await api.get<ApiRespuesta<AuditLog[]>>('/personal/logs', { params: { limit } });
    return res.data.data ?? [];
  },
};
