import axios, { AxiosError } from 'axios';
import type { ApiRespuesta } from '@/types';

// Cliente HTTP del PORTAL DEL ABONADO — instancia propia, deliberadamente separada de
// `@/lib/api`:
//   · Las cookies del portal son HttpOnly, así que no hay token que adjuntar a mano:
//     el navegador las envía con `withCredentials`.
//   · El interceptor del ERP redirige a /login y usa las cookies del operador. Aquí un
//     401 debe llevar a /portal/login y nunca tocar la sesión del ERP.
const portalHttp = axios.create({
  baseURL: '/api/v1/portal',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  withCredentials: true,
});

// ── Errores con vocabulario de portal ────────────────────────
// El abonado no puede leer un stack ni un status code. Estas clases distinguen los tres
// casos que exigen mensajes distintos: sistema caído, router mudo, y sesión vencida.
export type PortalErrorTipo = 'sesion' | 'red' | 'servidor' | 'router' | 'validacion';

export class PortalError extends Error {
  constructor(
    readonly tipo: PortalErrorTipo,
    mensaje: string,
    readonly status?: number,
  ) {
    super(mensaje);
    this.name = 'PortalError';
  }
}

function traducir(err: unknown): PortalError {
  if (!axios.isAxiosError(err)) {
    return new PortalError('servidor', 'Ocurrió un problema inesperado. Inténtalo de nuevo.');
  }
  const e = err as AxiosError<{ message?: string }>;
  const mensajeServidor = e.response?.data?.message;

  if (!e.response) {
    return new PortalError(
      'red',
      'No pudimos conectar con nuestro sistema. Revisa tu conexión e inténtalo en unos minutos.',
    );
  }
  const status = e.response.status;
  if (status === 401) {
    return new PortalError('sesion', mensajeServidor ?? 'Tu sesión expiró.', status);
  }
  if (status === 400 || status === 422) {
    return new PortalError('validacion', mensajeServidor ?? 'Revisa los datos ingresados.', status);
  }
  if (status === 503) {
    return new PortalError(
      'servidor',
      mensajeServidor ?? 'El servicio no está disponible en este momento.',
      status,
    );
  }
  return new PortalError(
    'servidor',
    mensajeServidor ?? 'No pudimos completar la operación. Inténtalo de nuevo.',
    status,
  );
}

async function pedir<T>(fn: () => Promise<{ data: ApiRespuesta<T> }>): Promise<T> {
  try {
    const { data } = await fn();
    return data.data;
  } catch (err) {
    throw traducir(err);
  }
}

// ── Tipos ────────────────────────────────────────────────────
export interface PortalSecciones {
  comprobantes:      boolean;
  soporte:           boolean;
  informarPago:      boolean;
  testVelocidad:     boolean;
  notificaciones:    boolean;
  wifi:              boolean;
  dispositivos:      boolean;
  planes:            boolean;
  consumo:           boolean;
  banner:            boolean;
  menuPersonalizado: boolean;
}

export interface PortalConfigPublica {
  titulo:                     string;
  logoUrl:                    string | null;
  colorPrimario:              string;
  tema:                       string;
  urlTestVelocidad:           string | null;
  tituloMenuPersonalizado:    string | null;
  contenidoMenuPersonalizado: string | null;
  reportePagoMedios:          string | null;
  secciones:                  PortalSecciones;
}

export interface PortalServicio {
  contratoId:      string;
  numeroContrato:  string;
  estado:          string;
  tipoServicio:    string | null;
  tipoPago:        string | null;
  direccion:       string | null;
  planNombre:      string;
  planDescripcion: string | null;
  velocidadBajada: number;
  velocidadSubida: number;
  precioMensual:   number;
  diaFacturacion:  number | null;
  fechaUltimoPago: string | null;
  fechaCorte:      string | null;
  enProrroga:      boolean;
  prorrogaHasta:   string | null;
  deudaTotal:      number;
  mesesDeuda:      number;
  tieneOnu:        boolean;
}

export interface PortalPerfil {
  clienteId:       string;
  nombreCompleto:  string;
  tipoDocumento:   string;
  numeroDocumento: string;
  telefono:        string | null;
  servicios:       PortalServicio[];
}

export interface PortalSesion {
  clienteId:      string;
  usuario:        string;
  nombreCompleto: string;
}

// ── API ──────────────────────────────────────────────────────
export const portalApi = {
  config: () => pedir<PortalConfigPublica>(() => portalHttp.get('/config')),

  login: (usuario: string, password: string) =>
    pedir<PortalSesion>(() => portalHttp.post('/auth/login', { usuario, password })),

  refresh: () => pedir<PortalSesion>(() => portalHttp.post('/auth/refresh')),

  logout: async (): Promise<void> => {
    try {
      await portalHttp.post('/auth/logout');
    } catch {
      // Cerrar sesión nunca debe fallar de cara al abonado: la cookie se invalida
      // igualmente en el servidor y el portal lo devuelve al login.
    }
  },

  me: () => pedir<PortalPerfil>(() => portalHttp.get('/me')),

  servicio: (contratoId: string) =>
    pedir<PortalServicio>(() => portalHttp.get(`/servicios/${contratoId}`)),
};
