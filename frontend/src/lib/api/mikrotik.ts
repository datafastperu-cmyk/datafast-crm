import api from '@/lib/api';

export type MetodoConexion        = 'api' | 'api_ssl' | 'ssh' | 'snmp' | 'vpn_tunnel';
export type VersionRouterOS       = 'v6' | 'v7' | 'desconocida';
export type EstadoEquipo          = 'online' | 'offline' | 'degradado' | 'mantenimiento' | 'desconocido';
export type TipoControl           = 'ninguna' | 'pppoe_addresslist' | 'amarre_ip_mac' | 'amarre_ip_mac_dhcp';
export type TipoControlVelocidad  = 'ninguno' | 'colas_simples' | 'pcq_addresslist' | 'dhcp_lease_queues';

export interface Router {
  id:               string;
  nombre:           string;
  descripcion?:     string;
  ubicacion?:       string;
  modelo?:          string;
  ipGestion:        string;
  vpnIp?:           string;
  zona?:            string;
  puertoApi:        number;
  puertoApiSsl:     number;
  puertoSsh:        number;
  usuario:          string;
  metodoConexion:   MetodoConexion;
  usarSsl:          boolean;
  timeoutConexion:  number;
  reintentos:       number;
  versionRos:       VersionRouterOS;
  estado:           EstadoEquipo;
  ultimoPing?:      string;
  latenciaMs?:      number;
  versionFirmware?: string;
  identityRouteros?: string;
  cpuUsoPct?:       number;
  memoriaUsoPct?:   number;
  uptimeSegundos?:  number;
  uptimeStr?:       string;
  totalSesionesPppoe?: number;
  tipoControl:             TipoControl;
  tipoControlVelocidad:   TipoControlVelocidad;
  autoConfigurarQueues:   boolean;
  autoConfigurarPppoe:    boolean;
  autoConfigurarFirewall: boolean;
  snmpCommunity:    string;
  subnetsLocales?:  string[];
  activo:           boolean;
  createdAt:        string;
}

export interface CreateRouterDto {
  nombre:          string;
  descripcion?:    string;
  ubicacion?:      string;
  modelo?:         string;
  ipGestion:       string;
  vpnIp?:          string;
  zona?:           string;
  puertoApi?:      number;
  puertoApiSsl?:   number;
  puertoSsh?:      number;
  usuario:         string;
  password:        string;
  metodoConexion?: MetodoConexion;
  usarSsl?:        boolean;
  timeoutConexion?: number;
  reintentos?:     number;
  versionRos?:     VersionRouterOS;
  tipoControl?:            TipoControl;
  tipoControlVelocidad?:  TipoControlVelocidad;
  autoConfigurarQueues?:   boolean;
  autoConfigurarPppoe?:    boolean;
  autoConfigurarFirewall?: boolean;
  snmpCommunity?:  string;
  latitud?:        number;
  longitud?:       number;
}

export interface UpdateRouterDto extends Partial<CreateRouterDto> {}

export interface AmareIpMacDto {
  ip:          string;
  mac:         string;
  hostname?:   string;
  clienteId?:  string;
  dhcpServer?: string;
}

export interface TestConexionDto {
  ip:              string;
  puerto:          number;
  usuario:         string;
  password?:       string;
  routerId?:       string;
  usarSsl?:        boolean;
  timeoutConexion?: number;
  metodoConexion?: MetodoConexion;
  versionRos?:     VersionRouterOS;
}

export interface TestConexionResult {
  exitoso:           boolean;
  mensaje:           string;
  latenciaMs?:       number;
  versionDetectada?: string;
  identityDetectada?: string;
  rosVersion?:       string;
}

export const mikrotikApi = {
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

  syncSubnets: async (id: string): Promise<{ subnets: string[] }> => {
    const { data } = await api.post(`/mikrotik/routers/${id}/sync-subnets`);
    return data.data;
  },

  testConexionDirecta: async (dto: TestConexionDto): Promise<TestConexionResult> => {
    const { data } = await api.post('/mikrotik/test-connection', dto);
    return data.data;
  },

  aplicarAmareIpMac: async (id: string, dto: AmareIpMacDto): Promise<{ arp: boolean; dhcp: boolean }> => {
    const { data } = await api.post(`/mikrotik/routers/${id}/amarre-ip-mac`, dto);
    return data.data;
  },

  getMorosos: async (id: string): Promise<Array<{ ip: string; comment: string; addedAt: string }>> => {
    const { data } = await api.get(`/mikrotik/routers/${id}/morosos`);
    return data.data;
  },
};
