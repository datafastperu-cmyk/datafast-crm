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

export const sistemaApi = {
  getInfo:      () => api.get<{ data: ServerInfo }>('/admin/sistema/info').then(r => r.data.data),
  getUpdateLog: () => api.get<{ data: { log: string } }>('/admin/sistema/update-log').then(r => r.data.data.log),
  restart:      () => api.post('/admin/sistema/restart'),
  update:       () => api.post('/admin/sistema/update'),
};
