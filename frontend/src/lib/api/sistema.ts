import api from '@/lib/api';

export interface VersionInfo {
  current:         string;
  remote:          string | null;
  updateAvailable: boolean;
}

export interface Proceso {
  name:     string;
  status:   string;
  uptime:   number;
  restarts: number;
  cpu:      number;
  memoryMb: number;
}

export interface ServerInfo {
  version: VersionInfo;
  update: {
    sourceType: string;
    sourceUrl:  string;
    branch:     string;
  };
  system: {
    uptime:   number;
    memoryMb: number;
    node:     string;
    platform: string;
    disk:     { total: string; used: string; free: string; usage: string } | null;
  };
  processes: Proceso[];
}

export type ProveedorActivo =
  | 'CUSTOM_API'
  | 'AUTOMATIZADO_VIP'
  | 'DATAFAST_MENSAJERIA_MASIVA';

export interface GatewayConfig {
  proveedorActivo:       ProveedorActivo;
  apiKeyStored:          boolean;
  apiSecretStored:       boolean;
  clientId:              string | null;
  pausa:                 number;
  limiteCaracteres:      number;
  codigoPais:            string;
  activo:                boolean;
  customApiActivo:       boolean;
  automatizadoVipActivo: boolean;
  limiteDiarioMasivo:   number;
  whatsappNumeroOrigen: string | null;
  notifBienvenidaActiva:   boolean;
  notifPagoRecibidoActiva: boolean;
  notifProrrogaActiva:     boolean;
  notifSuspensionActiva:   boolean;
}

export interface NotifLog {
  id:             string;
  contratoId:     string | null;
  telefono:       string;
  canal:          string;
  tipo_template:  string;
  estado_entrega: 'ENCOLADO' | 'EN_PROCESO' | 'ENVIADO' | 'ENVIADO_META' | 'NO_ENVIADO' | 'FALLIDO' | 'ENTREGADO' | 'LEIDO';
  provider_message_id: string | null;
  proveedor:      string | null;
  error_detalle:  string | null;
  created_at:     string;
  sent_at:        string | null;
  numero_contrato?: string | null;
  cliente_nombre?:  string | null;
}

export const sistemaApi = {
  getInfo:      () => api.get<{ data: ServerInfo }>('/admin/sistema/info').then(r => r.data.data),
  getUpdateLog: () => api.get<{ data: { log: string } }>('/admin/sistema/update-log').then(r => r.data.data.log),
  restart:      () => api.post('/admin/sistema/restart'),
  update:       () => api.post('/admin/sistema/update'),

  getNotifLogs: (params: { page?: number; limit?: number; estado?: string; tipo?: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC' }) =>
    api.get<{ data: { items: NotifLog[]; total: number } }>('/admin/sistema/notif-logs', { params })
       .then(r => r.data.data),

  previewNotifLog: (id: string) =>
    api.get<{ data: { tipo: string; telefono: string; cliente: string; texto: string } }>(
      `/admin/sistema/notif-logs/${id}/preview`,
    ).then(r => r.data.data),

  reenviarNotifLog: (id: string) =>
    api.post<{ data: { enviado: boolean; error?: string } }>(`/admin/sistema/notif-logs/${id}/reenviar`)
       .then(r => r.data.data),

  eliminarNotifLog: (id: string) =>
    api.delete(`/admin/sistema/notif-logs/${id}`),

  getGatewayConfig: () =>
    api.get<{ data: GatewayConfig }>('/admin/sistema/gateway-config').then(r => r.data.data),

  updateGatewayConfig: (dto: {
    proveedorActivo?:         ProveedorActivo;
    apiKey?:                  string;
    apiSecret?:               string;
    clientId?:                string;
    pausa?:                   number;
    limiteCaracteres?:        number;
    codigoPais?:              string;
    activo?:                  boolean;
    limiteDiarioMasivo?:      number;
    whatsappNumeroOrigen?:    string;
    notifBienvenidaActiva?:   boolean;
    notifPagoRecibidoActiva?: boolean;
    notifProrrogaActiva?:     boolean;
    notifSuspensionActiva?:   boolean;
  }) =>
    api.patch<{ data: GatewayConfig }>('/admin/sistema/gateway-config', dto).then(r => r.data.data),
};
