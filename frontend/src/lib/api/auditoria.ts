import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

// ─── Tipos ────────────────────────────────────────────────────
export interface AuditLog {
  id:              number;
  empresa_id:      string;
  usuario_id:      string;
  usuario_email:   string;
  accion:          string;
  modulo:          string;
  entidad_id:      string;
  descripcion:     string;
  ip_address:      string;
  metodo_http:     string;
  ruta:            string;
  datos_anteriores?: Record<string, any>;
  datos_nuevos?:     Record<string, any>;
  created_at:      string;
}

export interface AuditLogsResponse {
  data:        AuditLog[];
  total:       number;
  page:        number;
  limit:       number;
  totalPages:  number;
}

export interface UndoRedoEstado {
  canUndo:  boolean;
  canRedo:  boolean;
  lastUndo: { accion: string; modulo: string; descripcion: string; created_at: string } | null;
  lastRedo: { accion: string; modulo: string; descripcion: string; created_at: string } | null;
}

export interface PapeleraItem {
  id:          string;
  tabla:       string;
  display_name: string;
  deleted_at:  string;
}

export interface FiltrosAuditoria {
  search?:    string;
  modulo?:    string;
  accion?:    string;
  usuarioId?: string;
  desde?:     string;
  hasta?:     string;
  page?:      number;
  limit?:     number;
}

// ─── API ──────────────────────────────────────────────────────
export const auditoriaApi = {

  getLogs: async (filtros: FiltrosAuditoria = {}): Promise<AuditLogsResponse> => {
    const res = await api.get<ApiRespuesta<AuditLogsResponse>>('/auditoria/logs', { params: filtros });
    return res.data.data;
  },

  getEstado: async (): Promise<UndoRedoEstado> => {
    const res = await api.get<ApiRespuesta<UndoRedoEstado>>('/auditoria/estado');
    return res.data.data;
  },

  undo: async (): Promise<{ ok: boolean; descripcion: string }> => {
    const res = await api.post<ApiRespuesta<{ ok: boolean; descripcion: string }>>('/auditoria/undo');
    return res.data.data;
  },

  redo: async (): Promise<{ ok: boolean; descripcion: string }> => {
    const res = await api.post<ApiRespuesta<{ ok: boolean; descripcion: string }>>('/auditoria/redo');
    return res.data.data;
  },

  getPapelera: async (modulo?: string): Promise<PapeleraItem[]> => {
    const res = await api.get<ApiRespuesta<PapeleraItem[]>>('/auditoria/papelera', {
      params: modulo ? { modulo } : {},
    });
    return res.data.data ?? [];
  },

  restaurar: async (tabla: string, id: string): Promise<void> => {
    await api.post('/auditoria/papelera/restaurar', { tabla, id });
  },

  eliminarPermanente: async (tabla: string, id: string): Promise<void> => {
    await api.delete('/auditoria/papelera/eliminar', { data: { tabla, id } });
  },

  getHistorialEntidad: async (tabla: string, entidadId: string): Promise<any[]> => {
    const res = await api.get<ApiRespuesta<any[]>>(`/auditoria/entidad/${tabla}/${entidadId}`);
    return res.data.data ?? [];
  },

  restaurarVersion: async (versionId: string): Promise<{ ok: boolean; descripcion: string }> => {
    const res = await api.post<ApiRespuesta<{ ok: boolean; descripcion: string }>>(
      `/auditoria/version/${versionId}/restaurar`,
    );
    return res.data.data;
  },
};
