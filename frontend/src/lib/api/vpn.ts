import api from '@/lib/api';

export type EstadoVpnCliente = 'pendiente' | 'conectado' | 'desconectado' | 'revocado';

export type VersionRos = 'v6' | 'v7';

export interface VpnCliente {
  id:               string;
  empresaId:        string;
  nombre:           string;
  ubicacion?:       string;
  descripcion?:     string;
  nombreCert:       string;
  versionRos:       VersionRos;
  usarCertificados: boolean;
  vpnUsuario?:      string;
  cipher:           string;
  authAlg:          string;
  verifyServerCert: boolean;
  estado:           EstadoVpnCliente;
  vpnIp?:           string;
  routerId?:        string;
  tokenDescarga:    string;
  tokenExpiresAt:   string;
  ultimoHandshake?: string;
  ipReal?:          string;
  activo:           boolean;
  createdAt:        string;
}

export interface CrearVpnClienteDto {
  nombre:            string;
  ubicacion?:        string;
  descripcion?:      string;
  versionRos:        VersionRos;
  usarCertificados?: boolean;
  cipher?:           string;
  authAlg?:          string;
  verifyServerCert?: boolean;
}

export interface ValidarTunelResult {
  conectado:          boolean;
  vpnIp?:             string;
  ipReal?:            string;
  routerRegistrado?:  boolean;
  routerId?:          string;
  mensaje:            string;
}

export type TipoVpnAlerta = 'conexion_bloqueada' | 'sesion_eliminada';

export interface VpnAlerta {
  id:           string;
  cn:           string;
  routerId?:    string;
  routerNombre?: string;
  tipo:         TipoVpnAlerta;
  ipNueva?:     string;
  ipSesion?:    string;
  mensaje:      string;
  leida:        boolean;
  createdAt:    string;
}

export const vpnApi = {
  crear: async (dto: CrearVpnClienteDto): Promise<{ cliente: VpnCliente; script: string }> => {
    const { data } = await api.post('/openvpn/mikrotik-clients', dto);
    return data.data;
  },

  validarTunel: async (id: string): Promise<ValidarTunelResult> => {
    const { data } = await api.post(`/openvpn/mikrotik-clients/${id}/validar`);
    return data.data;
  },

  revocar: async (id: string): Promise<void> => {
    await api.delete(`/openvpn/mikrotik-clients/${id}`);
  },

  getScriptByRouterId: async (routerId: string): Promise<string> => {
    const { data } = await api.get(`/openvpn/mikrotik-clients/by-router/${routerId}/script`);
    return data.data.script;
  },

  listarAlertas: async (): Promise<VpnAlerta[]> => {
    const { data } = await api.get('/openvpn/mikrotik-clients/alertas');
    return data.data;
  },

  descartarAlerta: async (id: string): Promise<void> => {
    await api.post(`/openvpn/mikrotik-clients/${id}/descartar-alerta`);
  },
};
