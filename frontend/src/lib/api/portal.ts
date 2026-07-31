import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiRespuesta } from '@/types';

// Cliente HTTP del PORTAL DEL ABONADO — instancia propia, deliberadamente separada de
// `@/lib/api`:
//   · Las cookies del portal son HttpOnly, así que no hay token que adjuntar a mano:
//     el navegador las envía con `withCredentials`.
//   · El interceptor del ERP redirige a /login y usa las cookies del operador. Aquí un
//     401 debe llevar a /portal/login y nunca tocar la sesión del ERP.
// Exportada SOLO para que el test pueda sustituir el adaptador HTTP y ejercitar el
// interceptor de renovación. Ningún componente debe usarla directamente: para eso está
// `portalApi`, que traduce los errores al vocabulario del abonado.
export const portalHttp = axios.create({
  baseURL: '/api/v1/portal',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  withCredentials: true,
});

// ── Renovación silenciosa de la sesión ───────────────────────
// El token de acceso dura 30 min y el de refresco 12 h deslizantes. Sin este interceptor
// el abonado quedaba fuera a los 30 min de haber entrado — no de inactividad, sino
// contados desde el login — aunque tuviera un refresco válido: `/auth/refresh` existía y
// NADIE lo llamaba. Cambiar la clave del WiFi implica esperar a la ONU, y esa espera
// cruzaba el límite.
//
// El `??=` comparte una única promesa de refresco entre las peticiones que fallen
// mientras esa renovación está en vuelo. Motivo: al abrir el dashboard se disparan varias
// consultas en paralelo y todas verían el 401 a la vez; N POST /auth/refresh simultáneos
// rotarían el token N veces y los últimos reintentos irían con una cookie ya sustituida.
//
// Verificado en `portal.test.ts`: sustituir el `??=` por una asignación directa hace
// fallar la prueba con 3 refrescos en vez de 1.
let refrescoEnCurso: Promise<unknown> | null = null;

function renovarSesion(): Promise<unknown> {
  refrescoEnCurso ??= portalHttp
    .post('/auth/refresh')
    .finally(() => { refrescoEnCurso = null; });
  return refrescoEnCurso;
}

type PeticionReintentable = InternalAxiosRequestConfig & { _reintentada?: boolean };

portalHttp.interceptors.response.use(
  (respuesta) => respuesta,
  async (error: AxiosError) => {
    const peticion = error.config as PeticionReintentable | undefined;

    const renovable =
      error.response?.status === 401 &&
      peticion != null &&
      !peticion._reintentada &&
      // Un 401 en login/refresh/logout ES el veredicto, no algo que renovar: reintentarlo
      // sería un bucle contra el propio endpoint que acaba de rechazarnos.
      !(peticion.url ?? '').includes('/auth/');

    if (!renovable) return Promise.reject(error);

    peticion._reintentada = true;
    try {
      await renovarSesion();
    } catch {
      // El refresco tampoco vale: se propaga el 401 original para que la UI mande al
      // login. Enmascararlo dejaría al abonado en una pantalla que no carga nunca.
      return Promise.reject(error);
    }
    return portalHttp(peticion);
  },
);

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
  // Porcentaje de la velocidad contratada que el ISP compromete como mínimo.
  velocidadGarantizada: number | null;
  incluyeTv:       boolean;
  dispositivosTv:  number | null;
  limiteDatosGb:   number | null;
  accionAlLimite:  string | null;
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

// Mismos estados que `/red/olt` en el ERP: salen de `olt_onu_inventario.estado_operativo`,
// clasificado por el colector. Operador y abonado leen el mismo diagnostico.
export type EstadoRouterOnu =
  | 'encendido'
  | 'apagado'
  | 'fibra_cortada'
  | 'sin_conexion'
  | 'suspendido'
  | 'sin_datos';

export interface PortalEstadoRouter {
  estado:      EstadoRouterOnu;
  detalle:     string;
  // Momento en que el ERP observó el equipo en la OLT. El dato NO es en vivo: se muestra
  // su antigüedad para que el abonado sepa qué está leyendo.
  observadoEn: string | null;
  senalDbm:    number | null;
}

export interface PortalPerfil {
  clienteId:       string;
  nombreCompleto:  string;
  tipoDocumento:   string;
  numeroDocumento: string;
  telefono:        string | null;
  servicios:       PortalServicio[];
}

export type EstadoFacturaVisible = 'pagada' | 'pendiente' | 'vencida';

export interface PortalDetalleFactura {
  descripcion: string;
  importe:     number;
}

export interface PortalFactura {
  id:               string;
  numero:           string;
  concepto:         string;
  // Desglose por servicio: el comprobante es consolidado por cliente, asi que el total
  // no dice cuanto corresponde a cada servicio.
  detalle:          PortalDetalleFactura[];
  periodoInicio:    string;
  periodoFin:       string;
  fechaEmision:     string;
  fechaVencimiento: string;
  fechaPago:        string | null;
  total:            number;
  montoPagado:      number;
  saldo:            number;
  estado:           EstadoFacturaVisible;
}

export interface PortalEstadoCuenta {
  totalPendiente:    number;
  cantidadPendiente: number;
  cantidadVencida:   number;
  facturaMasAntigua: string | null;
  facturas:          PortalFactura[];
}

export type CarrilVisible = 'desconectado' | 'conectando' | 'conectado' | 'error';

export interface PortalOnuEstado {
  disponible: boolean;
  motivo:     string | null;
  carril:     CarrilVisible;
  vivo:       boolean;
  mensaje:    string;
}

export interface PortalBandaWifi {
  banda:  '2.4' | '5';
  ssid:   string | null;
  activa: boolean | null;
}

export interface PortalWifi {
  bandas:           PortalBandaWifi[];
  ultimaLectura:    string | null;
  editable:         boolean;
  motivoNoEditable: string | null;
}

export interface PortalDispositivo {
  nombre:   string;
  ip:       string | null;
  mac:      string | null;
  conexion: '2.4' | '5' | 'wifi' | 'lan';
  activo:   boolean;
}

export interface ResultadoWifi {
  // "confirmado" = releído del equipo. "sin_confirmar" = enviado y sin confirmar; nunca
  // se le dice al abonado "guardado" cuando no se pudo verificar.
  clase:   'confirmado' | 'sin_confirmar';
  mensaje: string;
}

export interface ConsumoDia {
  fecha:   string;
  rxBytes: number;
  txBytes: number;
}

export interface PortalConsumo {
  desde:        string;
  hasta:        string;
  totalRxBytes: number;
  totalTxBytes: number;
  dias:         ConsumoDia[];
  // 'no_disponible' NO significa 0 GB: significa que nadie lo midió. La UI debe
  // distinguirlos o le atribuye al abonado un consumo que nunca se registró.
  fuente:       'medido' | 'no_disponible';
}

export interface PortalTicket {
  id:           string;
  numero:       string;
  titulo:       string;
  descripcion:  string;
  categoria:    string;
  estado:       string;
  abierto:      boolean;
  solucion:     string | null;
  calificacion: number | null;
  creadoEn:     string;
  cerradoEn:    string | null;
}

export interface PortalSoporte {
  categorias: Array<{ id: string; label: string }>;
  tickets:    PortalTicket[];
}

export interface PortalPlan {
  id:              string;
  nombre:          string;
  descripcion:     string | null;
  velocidadBajada: number;
  velocidadSubida: number;
  precio:          number;
  esActual:        boolean;
  // Motivo por el que NO se puede solicitar, en lenguaje del abonado. null = disponible.
  bloqueo:         string | null;
}

export interface PortalSolicitudPlan {
  id:               string;
  estado:           string;
  planOrigen:       string;
  planDestino:      string;
  precioOrigen:     number;
  precioDestino:    number;
  notaCliente:      string | null;
  motivoResolucion: string | null;
  creadaEn:         string;
  resueltaEn:       string | null;
}

export interface PortalCatalogoPlanes {
  planes:             PortalPlan[];
  solicitudPendiente: PortalSolicitudPlan | null;
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

  estadoCuenta: (contratoId: string) =>
    pedir<PortalEstadoCuenta>(() => portalHttp.get(`/facturas/${contratoId}`)),

  estadoRouter: (contratoId: string) =>
    pedir<PortalEstadoRouter>(() => portalHttp.get(`/servicios/${contratoId}/router`)),

  // ── Mi WiFi ────────────────────────────────────────────────
  onuEstado: (contratoId: string) =>
    pedir<PortalOnuEstado>(() => portalHttp.get(`/onu/${contratoId}/estado`)),

  onuConectar: (contratoId: string) =>
    pedir<PortalOnuEstado>(() => portalHttp.post(`/onu/${contratoId}/conectar`)),

  onuHeartbeat: async (contratoId: string): Promise<void> => {
    // Best-effort: si un latido se pierde, el siguiente lo cubre. Nunca debe romper la
    // pantalla ni mostrar un error al abonado.
    try { await portalHttp.post(`/onu/${contratoId}/heartbeat`); } catch { /* ignorado */ }
  },

  // Carga normal: sirve la última lectura conocida (rápida). `refrescar` fuerza una
  // lectura viva contra el equipo, que espera al CPE y puede tardar varios segundos —
  // por eso es opt-in y no lo que ocurre al abrir la sección.
  onuWifi: (contratoId: string, refrescar = false) =>
    pedir<PortalWifi>(() =>
      portalHttp.get(`/onu/${contratoId}/wifi`, {
        params: refrescar ? { refrescar: '1' } : undefined,
        timeout: refrescar ? 45_000 : undefined,
      })),

  onuGuardarWifi: (contratoId: string, banda: '2.4' | '5', dto: { ssid?: string; password?: string }) =>
    pedir<ResultadoWifi>(() => portalHttp.put(`/onu/${contratoId}/wifi/${banda}`, dto)),

  // Mismo nombre y clave en las dos bandas: una sola operación, no dos llamadas al
  // endpoint por banda (chocarían con la espera entre cambios).
  onuGuardarWifiAmbas: (contratoId: string, dto: { ssid?: string; password?: string }) =>
    pedir<ResultadoWifi>(() => portalHttp.put(`/onu/${contratoId}/wifi`, dto)),

  onuDispositivos: (contratoId: string) =>
    pedir<PortalDispositivo[]>(() => portalHttp.get(`/onu/${contratoId}/dispositivos`)),

  // ── Consumo ────────────────────────────────────────────────
  // `rango` es opcional: sin él el backend devuelve el mes en curso.
  consumo: (contratoId: string, rango?: { desde: string; hasta: string }) =>
    pedir<PortalConsumo>(() =>
      portalHttp.get(`/consumo/${contratoId}`, { params: rango })),

  // ── Soporte ────────────────────────────────────────────────
  soporte: () => pedir<PortalSoporte>(() => portalHttp.get('/tickets')),

  crearTicket: (dto: { contratoId: string; categoria: string; descripcion: string }) =>
    pedir<PortalTicket>(() => portalHttp.post('/tickets', dto)),

  // ── Planes ─────────────────────────────────────────────────
  planes: (contratoId: string) =>
    pedir<PortalCatalogoPlanes>(() => portalHttp.get(`/planes/${contratoId}`)),

  // SOLICITA el cambio; no lo aplica. Lo ejecuta el operador por el flujo de negocio.
  solicitarPlan: (contratoId: string, planDestinoId: string, nota?: string) =>
    pedir<PortalSolicitudPlan>(() =>
      portalHttp.post(`/planes/${contratoId}/solicitud`, { planDestinoId, nota })),

  calificarTicket: async (
    id: string,
    dto: { calificacion: number; comentario?: string },
  ): Promise<void> => {
    await portalHttp.post(`/tickets/${id}/calificar`, dto);
  },
};
