import api from '@/lib/api';

async function downloadBlob(url: string, filename: string) {
  const response = await api.get(url, { responseType: 'blob' });
  const blob = new Blob([response.data], { type: 'text/plain' });
  const href = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export interface OpenvpnConfig {
  id:           string;
  nombre:       string;
  servidorIp:   string;
  puerto:       number;
  protocolo:    string;
  dispositivo:  string;
  vpnNetwork:   string;
  vpnNetmask:   string;
  caCert?:      string;
  serverCert?:  string;
  serverKey?:   string;
  dhParams?:    string;
  activo:       boolean;
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
}

export const openvpnApi = {
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

  downloadServerConf: () =>
    downloadBlob('/openvpn/config/download/server-conf', 'server.conf'),

  downloadInstrucciones: () =>
    downloadBlob('/openvpn/config/download/instrucciones', 'instalacion-openvpn.sh'),

  downloadClienteOvpn: (routerNombre: string) =>
    downloadBlob(
      `/openvpn/config/cliente/${encodeURIComponent(routerNombre)}`,
      `router-${routerNombre}.ovpn`,
    ),
};
