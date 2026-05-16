import api from '@/lib/api';

export type EstadoVpnCliente = 'pendiente' | 'conectado' | 'desconectado' | 'revocado';

export type VersionRos = 'v6' | 'v7';

export interface VpnCliente {
  id:              string;
  empresaId:       string;
  nombre:          string;
  ubicacion?:      string;
  descripcion?:    string;
  nombreCert:      string;
  versionRos:      VersionRos;
  estado:          EstadoVpnCliente;
  vpnIp?:          string;
  routerId?:       string;
  tokenDescarga:   string;
  tokenExpiresAt:  string;
  ultimoHandshake?: string;
  ipReal?:         string;
  activo:          boolean;
  createdAt:       string;
}

export interface CrearVpnClienteDto {
  nombre:       string;
  ubicacion?:   string;
  descripcion?: string;
  versionRos:   VersionRos;
}

export interface ValidarTunelResult {
  conectado:          boolean;
  vpnIp?:             string;
  ipReal?:            string;
  routerRegistrado?:  boolean;
  routerId?:          string;
  mensaje:            string;
}

export const vpnApi = {
  crear: async (dto: CrearVpnClienteDto): Promise<{ cliente: VpnCliente; script: string }> => {
    const { data } = await api.post('/openvpn/mikrotik-clients', dto);
    return data.data;
  },

  listar: async (): Promise<VpnCliente[]> => {
    const { data } = await api.get('/openvpn/mikrotik-clients');
    return data.data;
  },

  obtener: async (id: string): Promise<VpnCliente> => {
    const { data } = await api.get(`/openvpn/mikrotik-clients/${id}`);
    return data.data;
  },

  obtenerScript: async (id: string): Promise<string> => {
    const { data } = await api.get(`/openvpn/mikrotik-clients/${id}/script`);
    return data.data.script;
  },

  validarTunel: async (id: string): Promise<ValidarTunelResult> => {
    const { data } = await api.post(`/openvpn/mikrotik-clients/${id}/validar`);
    return data.data;
  },

  revocar: async (id: string): Promise<void> => {
    await api.delete(`/openvpn/mikrotik-clients/${id}`);
  },
};
