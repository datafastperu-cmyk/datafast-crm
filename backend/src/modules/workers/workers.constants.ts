// ─────────────────────────────────────────────────────────────
// Nombres de colas Bull centralizados
// Todos los workers del sistema ISP los importan de aquí.
// ─────────────────────────────────────────────────────────────

export const QUEUES = {
  COBRANZA:      'cobranza',       // Cortes, reactivaciones, prórrogas
  FACTURACION:   'facturacion',    // Generación masiva de facturas
  NOTIFICACIONES:'notificaciones', // WhatsApp / email masivo
  MIKROTIK:      'mikrotik-jobs',  // Operaciones Mikrotik encoladas
  GOOGLE_SYNC:   'google-sync',    // Sincronización Google Workspace
} as const;

// ─── Tipos de jobs por cola ────────────────────────────────
export const JOBS = {
  // ── Cobranza ──────────────────────────────────────────────
  DETECTAR_MOROSOS:          'detectar-morosos',
  SUSPENDER_CONTRATO:        'suspender-contrato',
  REACTIVAR_CONTRATO:        'reactivar-contrato',
  EVALUAR_PRORROGA:          'evaluar-prorroga',
  VENCER_PRORROGA:           'vencer-prorroga',
  PROCESAR_PAGO:             'procesar-pago',

  // ── Facturación ───────────────────────────────────────────
  GENERAR_FACTURAS_EMPRESA:  'generar-facturas-empresa',
  GENERAR_FACTURA_CONTRATO:  'generar-factura-contrato',
  MARCAR_FACTURAS_VENCIDAS:  'marcar-facturas-vencidas',

  // ── Notificaciones ────────────────────────────────────────
  NOTIF_COBRO_PREVIO:        'notif-cobro-previo',
  NOTIF_VENCIMIENTO:         'notif-vencimiento',
  NOTIF_CORTE:               'notif-corte',
  NOTIF_REACTIVACION:        'notif-reactivacion',
  NOTIF_FACTURA:             'notif-factura',

  // ── Mensajería Masiva Nativa (DATAFAST_NATIVE) ───────────
  CAMPANA_MASIVA:            'campana-masiva',

  // ── Mikrotik ──────────────────────────────────────────────
  MK_SUSPENDER:              'mk-suspender',
  MK_REACTIVAR:              'mk-reactivar',
  MK_SYNC_VELOCIDADES:       'mk-sync-velocidades',

  // ── Google Sync ───────────────────────────────────────────
  GOOGLE_SYNC_CONTACT:       'google-sync-contact',
  GOOGLE_SYNC_CONTACTS_BULK: 'google-sync-contacts-bulk',
  GOOGLE_CALENDAR_EVENT:     'google-calendar-event',
  GOOGLE_DRIVE_BACKUP:       'google-drive-backup',
  GOOGLE_GEOCODE_ADDRESS:    'google-geocode-address',
} as const;

// ─── Payloads tipados ─────────────────────────────────────
export interface PayloadSuspenderContrato {
  contratoId:    string;
  empresaId:     string;
  clienteId:     string;
  routerId:      string;
  ipAsignada:    string;
  usuarioPppoe:  string;
  deudaTotal:    number;
  mesesDeuda:    number;
  notificar?:    boolean;
}

export interface PayloadReactivarContrato {
  contratoId:    string;
  empresaId:     string;
  clienteId:     string;
  routerId:      string;
  ipAsignada:    string;
  planNombre:    string;
  notificar?:    boolean;
}

export interface PayloadEvaluarProrroga {
  contratoId:    string;
  empresaId:     string;
  clienteId:     string;
  prorrogaHasta: string;
}

export interface PayloadProcesarPago {
  pagoId:        string;
  facturaId:     string;
  contratoId:    string;
  empresaId:     string;
  montoPago:     number;
  fechaPago:     string;
}

export interface PayloadGenerarFacturasEmpresa {
  empresaId:     string;
  mes:           number;
  anio:          number;
  diaFacturacion?: number;   // Si es null, generar para todos los días
  forzar?:       boolean;   // Ignorar check de duplicados
}

export interface PayloadGenerarFacturaContrato {
  contratoId:    string;
  empresaId:     string;
  mes:           number;
  anio:          number;
}

export interface PayloadNotificacionCobro {
  clienteId:     string;
  empresaId:     string;
  contratoId?:   string;   // para logs de trazabilidad
  telefono:      string;
  nombre:        string;
  montoDeuda:    number;
  diasAntes:     number;
  facturaIds:    string[];
}

export interface PayloadMkSuspender {
  contratoId:    string;
  routerId:      string;
  empresaId:     string;
  ipAsignada:    string;
  usuarioPppoe:  string;
}

export interface PayloadCampanaMasiva {
  empresaId:   string;
  tipo:        string;
  contactos:   Array<{ telefono: string; variables: Record<string, string> }>;
  plantillaId?: string;
}

export interface PayloadMkReactivar {
  contratoId:    string;
  routerId:      string;
  empresaId:     string;
  ipAsignada:    string;
}

// ─── Matriz de prioridades por tipo de notificación ───────
// Menor número = mayor prioridad en Bull
export const JOB_PRIORITIES = {
  ONU_OFFLINE:     1,   // Alerta interna crítica
  ALERTA_EGRESO:   1,   // Alerta interna crítica
  FACTURA_EMITIDA: 2,   // Transaccional
  PAGO_RECIBIDO:   2,   // Transaccional
  CAMPANA_MASIVA:  3,   // Masivo / baja prioridad
} as const;

// Delay de goteo para lotes CAMPANA_MASIVA (ms por índice)
export function calcularDelayGoteo(index: number): number {
  return (index * 12_000) + Math.floor(Math.random() * 4_000);
}

// ─── Opciones de job por defecto ──────────────────────────
export const JOB_OPTIONS = {
  // Alertas internas (ONU_OFFLINE, ALERTA_EGRESO): prioridad máxima
  ALERTA: {
    priority: 1,
    attempts: 3,
    backoff:  { type: 'exponential' as const, delay: 15_000 },
    removeOnComplete: 200,
    removeOnFail:     500,
  },
  // Jobs críticos (suspensión, reactivación): 3 reintentos con backoff exponencial
  CRITICO: {
    attempts:  3,
    backoff:   { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: 500,
    removeOnFail:     1000,
  },
  // Jobs de notificación: 2 reintentos, no crítico si falla
  NOTIFICACION: {
    attempts:  2,
    backoff:   { type: 'fixed' as const, delay: 60_000 },
    removeOnComplete: 200,
    removeOnFail:     200,
  },
  // Jobs masivos (facturación): 1 reintento, se loggea si falla
  MASIVO: {
    attempts:  1,
    removeOnComplete: 100,
    removeOnFail:     500,
  },
  // Jobs de Mikrotik: 3 reintentos rápidos
  MIKROTIK: {
    attempts:  3,
    backoff:   { type: 'exponential' as const, delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail:     500,
  },
} as const;
