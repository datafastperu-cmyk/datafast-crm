import api from '@/lib/api';

export interface Router {
  id:              string;
  nombre:          string;
  descripcion?:    string;
  ubicacion?:      string;
  modelo?:         string;
  ipGestion:       string;
  vpnIp?:          string;
  puertoApi:       number;
  usuario:         string;
  metodoConexion:  string;
  usarSsl:         boolean;
  estado:          string;
  ultimoPing?:     string;
  latenciaMs?:     number;
  versionFirmware?: string;
  identityRouteros?: string;
  cpuUsoPct?:      number;
  memoriaUsoPct?:  number;
  tipoControl:     'ninguna' | 'amarre_ip_mac' | 'amarre_ip_mac_dhcp';
  activo:          boolean;
  createdAt:       string;
}

export interface CreateRouterDto {
  nombre:         string;
  descripcion?:   string;
  ubicacion?:     string;
  modelo?:        string;
  ipGestion:      string;
  vpnIp?:         string;
  puertoApi?:     number;
  usuario:        string;
  password:       string;
  metodoConexion?: string;
  usarSsl?:       boolean;
  timeoutConexion?: number;
  tipoControl?:   'ninguna' | 'amarre_ip_mac' | 'amarre_ip_mac_dhcp';
}

export interface UpdateRouterDto extends Partial<CreateRouterDto> {}

export interface AmareIpMacDto {
  ip:          string;
  mac:         string;
  hostname?:   string;
  clienteId?:  string;
  dhcpServer?: string;
}

export const mikrotikApi = {
  // Routers CRUD
  listar: async (): Promise<Router[]> => {
    const { data } = await api.get('/mikrotik/routers');
    return data.data;
  },

  obtener: async (id: string): Promise<Router> => {
    const { data } = await api.get(`/mikrotik/routers/${id}`);
    return data.data;
  },

  crear: async (dto: CreateRouterDto): Promise<Router> => {
    const { data } = await api.post('/mikrotik/routers', dto);
    return data.data;
  },

  actualizar: async (id: string, dto: UpdateRouterDto): Promise<Router> => {
    const { data } = await api.put(`/mikrotik/routers/${id}`, dto);
    return data.data;
  },

  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/mikrotik/routers/${id}`);
  },

  testConexion: async (id: string): Promise<{ exitoso: boolean; mensaje: string; latenciaMs?: number }> => {
    const { data } = await api.post(`/mikrotik/routers/${id}/test`);
    return data.data;
  },

  aplicarAmareIpMac: async (id: string, dto: AmareIpMacDto): Promise<{ arp: boolean; dhcp: boolean }> => {
    const { data } = await api.post(`/mikrotik/routers/${id}/amarre-ip-mac`, dto);
    return data.data;
  },
};
