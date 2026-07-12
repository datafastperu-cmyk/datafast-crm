// ─────────────────────────────────────────────────────────────
// Eventos del sistema de notificaciones
// Estos eventos se emiten desde los workers/servicios y son
// escuchados por NotificationEventListener para encolar los
// mensajes en la cola Bull NOTIFICACIONES de forma desacoplada.
// ─────────────────────────────────────────────────────────────

export const NOTIFICATION_EVENTS = {
  FACTURA_EMITIDA:      'notification.factura.emitida',
  PAGO_RECIBIDO:        'notification.pago.recibido',
  SERVICIO_SUSPENDIDO:  'notification.servicio.suspendido',
  SERVICIO_REACTIVADO:  'notification.servicio.reactivado',
  SERVICIO_ACTIVADO:    'notification.servicio.activado',
  BIENVENIDA:           'notification.bienvenida',
  PAGO_VENCE_HOY:       'notification.pago.vence.hoy',
  PAGO_VENCIDO:         'notification.pago.vencido',
  PRORROGA_CONCEDIDA:   'notification.prorroga.concedida',
  MANTENIMIENTO:        'notification.mantenimiento',
  ALERTA_EGRESO:        'notification.alerta.egreso',
  // Monitoreo de infraestructura
  EMISOR_CAIDO:         'notification.emisor.caido',
  EMISOR_CONECTADO:     'notification.emisor.conectado',
  ROUTER_CAIDO:         'notification.router.caido',
  ROUTER_CONECTADO:     'notification.router.conectado',
  // FTTH
  FTTH_ACTIVADO:        'ftth.cliente.activado',
  // Infraestructura — Outbox
  OUTBOX_RED_AGOTADO:   'notification.outbox_red.agotado',
  // IPTV — XUI ONE
  IPTV_LINE_CREADA:     'notification.iptv.line.creada',
} as const;

// ─── Payloads tipados para cada evento ───────────────────────

export interface EventNotificacionFacturaEmitida {
  telefono:        string;
  clienteNombre:   string;
  numeroFactura:   string;
  montoTotal:      string;
  fechaVencimiento: string;
  empresaId:       string;
  contratoId?:     string;
  clienteId?:      string;
}

export interface EventNotificacionPagoRecibido {
  telefono:       string;
  clienteNombre:  string;
  montoPago:      string;
  metodoPago:     string;
  saldoPendiente: string;
  empresaId:      string;
  contratoId?:    string;
  clienteId?:     string;
  pagoId?:        string;  // clave de idempotencia — evita duplicado pagos.service + cobranza.worker
}

export interface EventNotificacionServicioSuspendido {
  telefono:      string;
  clienteNombre: string;
  deudaTotal:    string;
  numeroCuenta?: string;
  nombreEmpresa?: string;
  empresaId:     string;
  contratoId?:   string;
  clienteId?:    string;
}

export interface EventNotificacionServicioReactivado {
  telefono:      string;
  clienteNombre: string;
  planNombre:    string;
  empresaId:     string;
  contratoId?:   string;
  clienteId?:    string;
}

export interface EventNotificacionBienvenida {
  telefono:        string;
  clienteNombre:   string;
  planNombre:      string;
  velocidadBajada: string;
  velocidadSubida: string;
  usuarioPppoe:    string;
  empresaId:       string;
  contratoId?:     string;
  clienteId?:      string;
}

export interface EventNotificacionPagoVenceHoy {
  telefono:      string;
  clienteNombre: string;
  montoDeuda:    string;
  linkPago?:     string;
  empresaId:     string;
  contratoId?:   string;
  clienteId?:    string;
}

export interface EventNotificacionPagoVencido {
  telefono:      string;
  clienteNombre: string;
  montoDeuda:    string;
  diasVencido:   string;
  numeroCuenta:  string;
  empresaId:     string;
  contratoId?:   string;
  clienteId?:    string;
}

export interface EventNotificacionProrrogaConcedida {
  telefono:      string;
  clienteNombre: string;
  fechaProrroga: string;
  montoDeuda:    string;
  empresaId:     string;
  contratoId?:   string;
  clienteId?:    string;
}

export interface EventNotificacionAlertaEgreso {
  telefono:      string;
  nombre_gasto:  string;
  categoria:     string;
  monto:         string;
  dias_restantes: string;
  empresaId:     string;
}

// ─── Monitoreo de infraestructura ────────────────────────────

export interface EventNotificacionEmisorCaido {
  nodoNombre: string;
  empresaId:  string;
}

export interface EventNotificacionEmisorConectado {
  nodoNombre: string;
  empresaId:  string;
}

export interface EventNotificacionRouterCaido {
  routerNombre: string;
  empresaId:    string;
}

export interface EventNotificacionRouterConectado {
  routerNombre: string;
  empresaId:    string;
}

export interface EventNotificacionFtthActivado {
  clienteId:       string;
  contratoId:      string;
  empresaId:       string;
  clienteNombre:   string;
  clienteTelefono: string;
  planNombre:      string;
  ipAsignada:      string;
  usuarioPppoe:    string;
}

export interface EventNotificacionIptvLineCreada {
  telefono:      string;
  clienteNombre: string;
  usuario:       string;
  password:      string;
  empresaId:     string;
  contratoId?:   string;
  clienteId?:    string;
}

export interface EventOutboxRedAgotado {
  contratoId:  string;
  routerId:    string;
  accion:      string;
  ultimoError: string;
  empresaId?:  string;
}