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

export type ProveedorActivo = 'META_GRAPH' | 'TWILIO' | 'VONAGE' | 'CUSTOM_API' | 'AUTOMATIZADO_VIP';

export interface GatewayConfig {
  proveedorActivo:  ProveedorActivo;
  apiKey:           string | null;
  apiSecret:        string | null;
  clientId:         string | null;
  pausa:            number;
  limiteCaracteres: number;
  codigoPais:       string;
  activo:           boolean;
}

export interface WhatsAppConfig {
  phoneId:    string | null;
  businessId: string | null;
  token:      string | null;
}

export interface NotifLog {
  id:             string;
  contratoId:     string | null;
  telefono:       string;
  canal:          string;
  tipo_template:  string;
  estado_entrega: 'ENCOLADO' | 'ENVIADO_META' | 'FALLIDO';
  meta_message_id: string | null;
  error_detalle:  string | null;
  created_at:     string;
  numero_contrato?: string | null;
  cliente_nombre?:  string | null;
}

export const sistemaApi = {
  getInfo:      () => api.get<{ data: ServerInfo }>('/admin/sistema/info').then(r => r.data.data),
  getUpdateLog: () => api.get<{ data: { log: string } }>('/admin/sistema/update-log').then(r => r.data.data.log),
  restart:      () => api.post('/admin/sistema/restart'),
  update:       () => api.post('/admin/sistema/update'),

  getWhatsAppConfig: () =>
    api.get<{ data: WhatsAppConfig }>('/admin/sistema/whatsapp-config').then(r => r.data.data),

  updateWhatsAppConfig: (dto: { token?: string; phoneId?: string; businessId?: string }) =>
    api.patch<{ data: WhatsAppConfig }>('/admin/sistema/whatsapp-config', dto).then(r => r.data.data),

  getNotifLogs: (params: { page?: number; limit?: number; estado?: string; tipo?: string }) =>
    api.get<{ data: { items: NotifLog[]; total: number } }>('/admin/sistema/notif-logs', { params })
       .then(r => r.data.data),

  getGatewayConfig: () =>
    api.get<{ data: GatewayConfig }>('/admin/sistema/gateway-config').then(r => r.data.data),

  updateGatewayConfig: (dto: {
    proveedorActivo?:  ProveedorActivo;
    apiKey?:           string;
    apiSecret?:        string;
    clientId?:         string;
    pausa?:            number;
    limiteCaracteres?: number;
    codigoPais?:       string;
    activo?:           boolean;
  }) =>
    api.patch<{ data: GatewayConfig }>('/admin/sistema/gateway-config', dto).then(r => r.data.data),
};
