import api from '@/lib/api';
import type { ApiRespuesta, PaginaRespuesta, PaginaMeta } from '@/types';

export type CategoriaTicket =
  | 'sin_internet' | 'lentitud' | 'intermitencia' | 'corte_de_luz'
  | 'equipo_danado' | 'cambio_plan' | 'cambio_datos' | 'facturacion'
  | 'instalacion' | 'traslado' | 'otro';

export type PrioridadTicket = 'baja' | 'media' | 'alta' | 'critica';
export type EstadoTicket =
  | 'abierto' | 'en_progreso' | 'pendiente_cliente'
  | 'pendiente_tecnico' | 'resuelto' | 'cerrado' | 'cancelado';

export interface Ticket {
  id:                 string;
  numeroTicket:       string;
  titulo:             string;
  descripcion:        string;
  categoria:          CategoriaTicket;
  prioridad:          PrioridadTicket;
  estado:             EstadoTicket;
  empresaId:          string;
  clienteId:          string;
  clienteNombre?:     string;
  clienteTelefono?:   string;
  contratoId?:        string;
  contratoNumero?:    string;
  tecnicoId?:         string;
  tecnicoNombre?:     string;
  slaHoras:           number;
  fechaLimiteSla?:    string;
  slaCumplido?:       boolean;
  solucion?:          string;
  causaRaiz?:         string;
  calificacionCliente?: number;
  comentarioCliente?: string;
  abiertoPorPortal:   boolean;
  createdAt:          string;
  updatedAt:          string;
  closedAt?:          string;
}

export interface TicketComentario {
  id:            number;
  contenido:     string;
  esPrivado:     boolean;
  esNotaInterna: boolean;
  autorNombre?:  string;
  autorId?:      string;
  createdAt:     string;
}

export interface TicketStats {
  abiertos:               number;
  nuevos:                 number;
  enProgreso:             number;
  resueltos:              number;
  cerrados:               number;
  criticos:               number;
  slaVencidos:            number;
  tiempoResolucionHoras:  number;
  creadosEsteMes:         number;
}

export interface FiltrosTicket {
  search?:     string;
  estado?:     EstadoTicket;
  estados?:    EstadoTicket[];
  categoria?:  CategoriaTicket;
  prioridad?:  PrioridadTicket;
  clienteId?:  string;
  tecnicoId?:  string;
  slaPendiente?: boolean;
  fechaDesde?: string;
  fechaHasta?: string;
  page?:       number;
  limit?:      number;
  sortBy?:     string;
  sortOrder?:  'ASC' | 'DESC';
}

export const ticketLabels: Record<EstadoTicket, string> = {
  abierto:           'Abierto',
  en_progreso:       'En progreso',
  pendiente_cliente: 'Pendiente cliente',
  pendiente_tecnico: 'Pendiente técnico',
  resuelto:          'Resuelto',
  cerrado:           'Cerrado',
  cancelado:         'Cancelado',
};

export const prioridadLabels: Record<PrioridadTicket, string> = {
  baja:    'Baja',
  media:   'Media',
  alta:    'Alta',
  critica: 'Crítica',
};

export const categoriaLabels: Record<CategoriaTicket, string> = {
  sin_internet:  'Sin internet',
  lentitud:      'Lentitud',
  intermitencia: 'Intermitencia',
  corte_de_luz:  'Corte de luz',
  equipo_danado: 'Equipo dañado',
  cambio_plan:   'Cambio de plan',
  cambio_datos:  'Cambio de datos',
  facturacion:   'Facturación',
  instalacion:   'Instalación',
  traslado:      'Traslado',
  otro:          'Otro',
};

// ─── API calls ────────────────────────────────────────────────
export const ticketsApi = {
  getStats: () =>
    api.get<ApiRespuesta<TicketStats>>('/tickets/stats').then(r => r.data.data),

  getAll: (filters: FiltrosTicket = {}) =>
    api.get<ApiRespuesta<Ticket[]>>('/tickets', { params: filters }).then(r => r.data),

  getOne: (id: string) =>
    api.get<ApiRespuesta<Ticket>>(`/tickets/${id}`).then(r => r.data.data),

  create: (dto: {
    clienteId: string; titulo: string; descripcion: string;
    categoria?: CategoriaTicket; prioridad?: PrioridadTicket;
    contratoId?: string; tecnicoId?: string; slaHoras?: number;
  }) => api.post<ApiRespuesta<Ticket>>('/tickets', dto).then(r => r.data.data),

  update: (id: string, dto: Partial<Ticket & { estado: EstadoTicket }>) =>
    api.patch<ApiRespuesta<Ticket>>(`/tickets/${id}`, dto).then(r => r.data.data),

  cerrar: (id: string, solucion: string, causaRaiz?: string) =>
    api.patch<ApiRespuesta<Ticket>>(`/tickets/${id}/cerrar`, { solucion, causaRaiz }).then(r => r.data.data),

  asignar: (id: string, tecnicoId: string) =>
    api.patch<ApiRespuesta<Ticket>>(`/tickets/${id}/asignar/${tecnicoId}`).then(r => r.data.data),

  calificar: (id: string, calificacion: number, comentario?: string) =>
    api.patch<ApiRespuesta<Ticket>>(`/tickets/${id}/calificar`, { calificacion, comentario }).then(r => r.data.data),

  delete: (id: string) =>
    api.delete(`/tickets/${id}`),

  getComentarios: (id: string) =>
    api.get<ApiRespuesta<TicketComentario[]>>(`/tickets/${id}/comentarios`).then(r => r.data.data),

  addComentario: (id: string, contenido: string, esPrivado = false, esNotaInterna = false) =>
    api.post<ApiRespuesta<TicketComentario>>(`/tickets/${id}/comentarios`, {
      contenido, esPrivado, esNotaInterna,
    }).then(r => r.data.data),
};
