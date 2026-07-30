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

  // ⚠ SIN BACKEND y SIN USO en la UI. `/onus/:id/estado-real` y `/onus/sin-contrato` no
  // existen en smartolt.controller.ts; lo más parecido que sí existe es
  // `/onus/:id/senal` y `/onus/sin-aprovisionar`, que NO son lo mismo (una ONU sin
  // aprovisionar no es una ONU sin contrato). No se remapean por eso: adivinar la
  // equivalencia sería peor que dejar el hueco visible. Requieren decisión.
  getOnuEstadoReal: (id: string) =>
    api.get<ApiRespuesta<any>>(`/smartolt/onus/${id}/estado-real`).then(r => r.data.data),

  sinContrato: () =>
    api.get<ApiRespuesta<Onu[]>>('/smartolt/onus/sin-contrato').then(r => r.data.data ?? []),
};
