import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

export type EstadoOlt = 'online' | 'offline' | 'mantenimiento' | 'desconocido';
export type EstadoOnu = 'sin_aprovisionar' | 'aprovisionada' | 'online' | 'offline' | 'error' | 'reemplazada';

export interface Olt {
  id:           string;
  nombre:       string;
  descripcion?: string;
  marca:        string;
  modelo?:      string;
  smartoltId?:  string;
  ipGestion?:   string;
  estado:       EstadoOlt;
  ultimoPing?:  string;
  totalPuertos: number;
  activo:       boolean;
  createdAt:    string;
}

export interface Onu {
  id:              string;
  empresaId:       string;
  oltId:           string;
  oltNombre?:      string;
  contratoId?:     string;
  contratoNumero?: string;
  clienteNombre?:  string;
  serialNumber:    string;
  nombre?:         string;
  modelo?:         string;
  puertoOlt?:      string;
  vlan?:           number;
  rxPowerDbm?:     number;
  txPowerDbm?:     number;
  estado:          EstadoOnu;
  ultimaVez?:      string;
  createdAt:       string;
}

export const smartoltApi = {
  // OLTs
  listarOlts: () =>
    api.get<ApiRespuesta<Olt[]>>('/smartolt/olts').then(r => r.data.data ?? []),

  getOlt: (id: string) =>
    api.get<ApiRespuesta<Olt>>(`/smartolt/olts/${id}`).then(r => r.data.data),

  health: () =>
    api.get<ApiRespuesta<any>>('/smartolt/health').then(r => r.data.data),

  // ONUs
  listarOnus: (filtros?: { oltId?: string; estado?: EstadoOnu; sinContrato?: boolean; page?: number; limit?: number }) =>
    api.get<ApiRespuesta<any>>('/smartolt/onus', { params: filtros }).then(r => r.data),

  // Se eliminaron `getOnuEstadoReal` y `sinContrato`: ninguna la usaba un componente y
  // ninguna tenía endpoint. Lo más parecido que sí existe (`/onus/:id/senal`,
  // `/onus/sin-aprovisionar`) NO es equivalente —una ONU sin aprovisionar no es una ONU
  // sin contrato—, así que no se remapearon a ciegas: si alguna vez hacen falta, se
  // implementan contra el endpoint correcto.
};
