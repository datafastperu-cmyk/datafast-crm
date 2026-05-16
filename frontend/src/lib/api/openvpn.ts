import api from '@/lib/api';

async function downloadBlob(url: string, filename: string, mimeType = 'text/plain') {
  const response = await api.get(url, { responseType: 'blob' });
  const blob = new Blob([response.data], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export interface OpenvpnConfig {
  id:            string;
  nombre:        string;
  servidorIp:    string;
  puerto:        number;
  protocolo:     string;
  dispositivo:   string;
  vpnNetwork:    string;
  vpnNetmask:    string;
  caCert?:       string;
  serverCert?:   string;
  serverKey?:    string;
  dhParams?:     string;
  taKey?:        string;
  installedAt?:  string;
  caExpiry?:     string;
  serverExpiry?: string;
  activo:        boolean;
}

export interface UpsertOpenvpnDto {
  nombre?:      string;
  servidorIp:   string;
  puerto?:      number;
  protocolo?:   string;
  dispositivo?: string;
  vpnNetwork?:  string;
  vpnNetmask?:  string;
  caCert?:      string;
  serverCert?:  string;
  serverKey?:   string;
  dhParams?:    string;
  taKey?:       string;
}

export interface VpnConnectedClient {
  commonName:     string;
  realAddress:    string;
  vpnAddress:     string;
  bytesReceived:  number;
  bytesSent:      number;
  connectedSince: string;
}

export interface VpnSystemStatus {
  installed:        boolean;
  serviceActive:    boolean;
  serviceEnabled:   boolean;
  openvpnVersion:   string;
  port:             number;
  protocol:         string;
  network:          string;
  serverIp:         string;
  connectedClients: VpnConnectedClient[];
  tunInterface:     string | null;
  tunIp:            string | null;
  caExpiry:         string | null;
  serverExpiry:     string | null;
  installedAt:      string | null;
  lastError:        string | null;
}

export const openvpnApi = {
  // ── Config CRUD ──────────────────────────────────────────────
  getConfig: async (): Promise<OpenvpnConfig | null> => {
    const { data } = await api.get('/openvpn/config');
    return data.data;
  },

  upsertConfig: async (dto: UpsertOpenvpnDto): Promise<OpenvpnConfig> => {
    const { data } = await api.post('/openvpn/config', dto);
    return data.data;
  },

  deleteConfig: async (): Promise<void> => {
    await api.delete('/openvpn/config');
  },

  syncCerts: async (): Promise<OpenvpnConfig> => {
    const { data } = await api.post('/openvpn/config/sync-certs');
    return data.data;
  },

  // ── Estado del sistema ───────────────────────────────────────
  getSystemStatus: async (): Promise<VpnSystemStatus> => {
    const { data } = await api.get('/openvpn/system/status');
    return data.data;
  },

  // ── Control del servicio ─────────────────────────────────────
  controlService: async (action: 'start' | 'stop' | 'restart' | 'reload'): Promise<{ ok: boolean; output: string }> => {
    const { data } = await api.post(`/openvpn/service/${action}`);
    return data.data;
  },

  // ── Clientes ─────────────────────────────────────────────────
  listClients: async (): Promise<string[]> => {
    const { data } = await api.get('/openvpn/clients');
    return data.data ?? [];
  },

  generateClient: async (nombre: string): Promise<void> => {
    await api.post(`/openvpn/clients/${encodeURIComponent(nombre)}/generate`);
  },

  downloadClient: (nombre: string) =>
    downloadBlob(
      `/openvpn/clients/${encodeURIComponent(nombre)}/download`,
      `${nombre}.ovpn`,
      'application/x-openvpn-profile',
    ),

  revokeClient: async (nombre: string): Promise<void> => {
    await api.delete(`/openvpn/clients/${encodeURIComponent(nombre)}`);
  },

  // ── Logs ─────────────────────────────────────────────────────
  getLogs: async (lines = 100): Promise<string> => {
    const { data } = await api.get('/openvpn/logs', { params: { lines } });
    return data.data?.logs ?? '';
  },

  // ── Descargas legacy ─────────────────────────────────────────
  downloadServerConf: () =>
    downloadBlob('/openvpn/config/download/server-conf', 'server.conf'),

  downloadInstrucciones: () =>
    downloadBlob('/openvpn/config/download/instrucciones', 'instalacion-openvpn.sh'),

  downloadClienteOvpn: (routerNombre: string) =>
    downloadBlob(
      `/openvpn/config/cliente/${encodeURIComponent(routerNombre)}`,
      `router-${routerNombre}.ovpn`,
      'application/x-openvpn-profile',
    ),
};
