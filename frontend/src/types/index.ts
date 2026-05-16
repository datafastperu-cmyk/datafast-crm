// ─── Auth ─────────────────────────────────────────────────────
export interface Usuario {
  id:            string;
  nombreCompleto: string;
  email:         string;
  fotoUrl?:      string;
  empresaId:     string;
  roles:         string[];
  permisos:      string[];
  tema:          'dark' | 'light' | 'auto';
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
  tokenType:    string;
  usuario:      Usuario;
}

// ─── Paginación ───────────────────────────────────────────────
export interface PaginaMeta {
  total:       number;
  page:        number;
  limit:       number;
  totalPages:  number;
  hasNext:     boolean;
  hasPrev:     boolean;
}

export interface PaginaRespuesta<T> {
  data:    T[];
  meta:    PaginaMeta;
}

export interface ApiRespuesta<T = unknown> {
  success:   boolean;
  data:      T;
  message?:  string;
  meta?:     Record<string, unknown>;
}

// ─── Historial de eventos (compartido entre módulos) ──────────
export interface HistorialEntry {
  id?:           string;
  accion?:       string;
  descripcion?:  string;
  usuarioEmail?: string;
  createdAt?:    string;
  timestamp?:    string;
  estadoNuevo?:  string;
  motivo?:       string;
  automatico?:   boolean;
  metadata?:     Record<string, unknown>;
}

// ─── Clientes ─────────────────────────────────────────────────
export type EstadoCliente =
  | 'activo' | 'suspendido' | 'moroso'
  | 'baja_temporal' | 'baja_definitiva' | 'prospecto';

export type TipoDocumento = 'dni' | 'ruc' | 'ce' | 'pasaporte';
export type TipoServicio  = 'ftth' | 'wisp' | 'dedicado' | 'mixto';

export interface Cliente {
  id:               string;
  tipoDocumento:    TipoDocumento;
  numeroDocumento:  string;
  nombres:          string;
  apellidoPaterno:  string;
  apellidoMaterno?: string;
  nombreCompleto:   string;
  email?:           string;
  telefono:         string;
  telefonoAlt?:     string;
  whatsapp?:        string;
  direccion:        string;
  referencia?:      string;
  departamento?:    string;
  provincia?:       string;
  distrito?:        string;
  ubigeo?:          string;
  latitud?:         number;
  longitud?:        number;
  fotoUrl?:         string;
  estado:           EstadoCliente;
  fechaEstado:      string;
  tipoServicio?:    TipoServicio;
  codigoCliente?:   string;
  esEmpresa:        boolean;
  rucEmpresa?:      string;
  razonSocial?:     string;
  etiquetas?:       string[];
  notasInternas?:   string;
  reniecConsultado: boolean;
  createdAt:        string;
}

// ─── Planes ───────────────────────────────────────────────────
export type TipoPlan    = 'residencial' | 'empresarial' | 'dedicado' | 'prepago';
export type TipoQueue   = 'simple_queue' | 'queue_tree' | 'pcq' | 'sin_limite';

export interface Plan {
  id:               string;
  nombre:           string;
  descripcion?:     string;
  tipo:             TipoPlan;
  colorUi:          string;
  velocidadBajada:  number;
  velocidadSubida:  number;
  burstBajada?:     number;
  burstSubida?:     number;
  precio:           number;
  precioInstalacion: number;
  aplicaIgv:        boolean;
  tipoQueue:        TipoQueue;
  pppProfile?:      string;
  activo:           boolean;
  visibleEnPortal:  boolean;
  ordenDisplay:     number;
}

// ─── Contratos ────────────────────────────────────────────────
export type EstadoContrato =
  | 'pendiente_instalacion' | 'activo' | 'suspendido_mora'
  | 'suspendido_manual' | 'prorroga' | 'baja_solicitada'
  | 'baja_definitiva' | 'migrado';

export interface Contrato {
  id:              string;
  empresaId:       string;
  clienteId:       string;
  planId:          string;
  numeroContrato:  string;
  estado:          EstadoContrato;
  fechaEstado:     string;
  fechaInicio:     string;
  fechaVencimiento?: string;
  fechaInstalacion?: string;
  ipAsignada?:     string;
  usuarioPppoe?:   string;
  precioMensual:   number;
  descuentoPct:    number;
  precioFinal:     number;
  deudaTotal:      number;
  mesesDeuda:      number;
  enProrroga:      boolean;
  prorrogaHasta?:  string;
  aprovisionado:   boolean;
  // JOINs
  clienteNombre?:  string;
  clienteTelefono?: string;
  planNombre?:     string;
  velocidadBajada?: number;
  velocidadSubida?: number;
  routerNombre?:   string;
}

// ─── Facturas ─────────────────────────────────────────────────
export type EstadoFactura =
  | 'borrador' | 'emitida' | 'pagada' | 'pagada_parcial'
  | 'vencida' | 'anulada' | 'en_cobranza';

export interface Factura {
  id:               string;
  numeroCompleto:   string;
  serie:            string;
  correlativo:      number;
  tipoComprobante:  string;
  clienteId:        string;
  contratoId?:      string;
  periodoInicio:    string;
  periodoFin:       string;
  descripcion:      string;
  subtotal:         number;
  igv:              number;
  total:            number;
  montoPagado:      number;
  saldo:            number;
  estado:           EstadoFactura;
  fechaEmision:     string;
  fechaVencimiento: string;
  fechaPago?:       string;
  pdfUrl?:          string;
  generadaAutomaticamente: boolean;
  // Campos denormalizados
  clienteNombre?:   string;
  items?:           FacturaItem[];
}

export interface FacturaItem {
  descripcion:   string;
  cantidad:      number;
  precioUnitario: number;
  subtotal:      number;
}

// ─── Pagos ────────────────────────────────────────────────────
export type MetodoPago =
  | 'efectivo' | 'yape' | 'plin' | 'transferencia_bancaria'
  | 'deposito_bancario' | 'mercadopago' | 'tarjeta_credito'
  | 'tarjeta_debito' | 'cheque' | 'otro';

export type EstadoPago =
  | 'pendiente_verificacion' | 'verificado' | 'rechazado' | 'devuelto';

export interface Pago {
  id:              string;
  clienteId:       string;
  facturaId?:      string;
  contratoId?:     string;
  monto:           number;
  moneda:          string;
  metodoPago:      MetodoPago;
  banco?:          string;
  numeroOperacion?: string;
  estado:          EstadoPago;
  fechaPago:       string;
  registradoEn:    string;
  notas?:          string;
  comprobanteUrl?: string;
  conciliado:      boolean;
  // Campos denormalizados (viene del backend o mock)
  clienteNombre?:  string;
  cliente_nombre?: string;
}

// ─── Monitoreo ────────────────────────────────────────────────
export type EstadoNodo   = 'online' | 'offline' | 'degradado' | 'mantenimiento' | 'desconocido';
export type NivelAlerta  = 'info' | 'warning' | 'critical' | 'recovery';
export type EstadoAlerta = 'activa' | 'resuelta' | 'ignorada';

export interface Nodo {
  id:            string;
  nombre:        string;
  tipo:          string;
  ipMonitoreo:   string;
  estado:        EstadoNodo;
  latenciaMs?:   number;
  perdidaPct?:   number;
  cpuUsoPct?:    number;
  memoriaUsoPct?: number;
  traficoRxBps?: number;
  traficoTxBps?: number;
  temperaturaC?: number;
  sesionesPppoe?: number;
  ultimoPing?:   string;
  estadoDesde?:  string;
  latitud?:      number;
  longitud?:     number;
}

export interface Alerta {
  id:          string;
  nodoId?:     string;
  nodoNombre?: string;
  nivel:       NivelAlerta;
  estado:      EstadoAlerta;
  metrica:     string;
  mensaje:     string;
  valorActual?: number;
  umbral?:     number;
  createdAt:   string;
  resueltaEn?: string;
  duracionMinutos?: number;
}

// ─── Dashboard ────────────────────────────────────────────────
export interface DashboardStats {
  clientes:    { total: number; activos: number; morosos: number; nuevosHoy: number; nuevosMes: number };
  contratos:   { total: number; activos: number; suspendidos: number; porVencer: number };
  facturacion: { cobradoHoy: number; cobradoMes: number; cuentasPorCobrar: number; tasaCobranza: number; meta: number };
  nodos:       { total: number; online: number; offline: number; degradado: number };
  alertas:     { activas: number; criticas: number; warnings: number };
  tickets:     { abiertos: number; urgentes: number; resueltosMes: number };
  pppoe:       { sesionesActivas: number; pico24h: number };
  banda:       { totalRxMbps: number; totalTxMbps: number; capacidad: number };
}

// ─── WebSocket events ─────────────────────────────────────────
export interface WsEventMedicion {
  nodoId:       string;
  nodoNombre:   string;
  estado:       EstadoNodo;
  latenciaMs:   number | null;
  perdidaPct:   number;
  cpuPct?:      number;
  memoriaPct?:  number;
  traficoRxBps?: number;
  traficoTxBps?: number;
  temperatura?: number;
  sesionesPppoe?: number;
  timestamp:    string;
}

export interface WsEventAlerta {
  tipo:    'nueva' | 'resuelta';
  alerta:  Alerta;
  timestamp: string;
}

export interface WsEventNodoStatus {
  nodoId:     string;
  nodoNombre: string;
  estado:     'online' | 'offline';
  timestamp:  string;
}

export interface WsEventDashboard {
  online:        number;
  offline:       number;
  degradado:     number;
  total:         number;
  latenciaAvg:   number;
  totalRxBps:    number;
  totalTxBps:    number;
  totalSesiones: number;
  timestamp:     string;
}
