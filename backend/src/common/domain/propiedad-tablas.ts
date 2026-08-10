// ═══════════════════════════════════════════════════════════════════════════
// Manifiesto de propiedad de tablas — ADR-032 · política PA-12
//
// «Cada tabla tiene un módulo que la escribe. Los demás la leen a través de él.»
//
// PA-12 llevaba escrita desde la emisión del corpus y no impedía nada: al medirlo el
// 2026-08-08, **diez módulos escribían `contratos`** y cinco escribían `clientes`. La
// separación Core / degradable existía como organización de carpetas, no como frontera de
// propiedad. Este fichero es lo que la convierte en algo verificable.
//
// LÍMITE DECLARADO: la barrera que lo comprueba detecta **solo SQL crudo** en literales de
// plantilla. Las escrituras vía repositorio TypeORM no se ven — por eso `usuarios` figura
// con un único escritor y `vpn_clientes` con `mantenimiento`, que es falso. Las cifras de
// aquí son un SUELO, no un total. Ampliar la detección al repositorio es trabajo posterior;
// fingir que ya cubre todo sería la afirmación sin verificar que este corpus prohíbe.
// ═══════════════════════════════════════════════════════════════════════════

export interface PropiedadTabla {
  /** Módulo que puede escribirla. Los demás la leen a través de él. */
  dueno: string;
  /**
   * Módulos que hoy la escriben sin ser el dueño. **Es deuda declarada, no permiso.**
   * Se enumeran para que la cifra esté congelada: puede bajar, nunca subir. Cada uno se
   * corrige cuando ese módulo se toque por otra razón (alcance incremental, como VIO).
   */
  infractores?: string[];
  /** Excepción justificada: no es deuda, es diseño. Exige motivo escrito. */
  excepcion?: string;
}

export const PROPIEDAD_TABLAS: Record<string, PropiedadTabla> = {
  // ── Core: el dinero y el abonado ───────────────────────────────────────────
  servicios: {
    dueno: 'contratos',
    infractores: [
      'promesas-pago', 'smartolt', 'workers', 'clientes', 'facturacion',
      'google-integration', 'olt-nativo', 'outbox-red', 'reconciliador',
    ],
    excepcion:
      'La columna `deuda_total` es propiedad de `facturacion` por declaración expresa ' +
      '(ADR-032 §3, forma 2): es un dato de facturación custodiado en una tabla de contratos. ' +
      'Su único escritor es DeudaPorContratoService. NO se resuelve con un servicio pasarela ' +
      'en contratos: ese método existía y se eliminó en ADR-019 por ser una puerta que aceptaba ' +
      'cifras sin respaldo documental.',
  },
  clientes: {
    dueno: 'clientes',
    infractores: ['contratos', 'promesas-pago', 'google-integration', 'workers'],
  },
  facturas: { dueno: 'facturacion', infractores: ['clientes', 'workers'] },
  pagos:    { dueno: 'pagos',       infractores: ['clientes', 'workers'] },
  empresas: { dueno: 'sistema',     infractores: ['backup'] },

  clientes_historial_estados: { dueno: 'clientes',  infractores: ['contratos', 'promesas-pago', 'workers'] },
  // 'outbox-red' entra el 2026-08-09 (fase 1): es quien aplica el corte por prórroga vencida en
  // el MikroTik, así que es el único que sabe cuándo el contrato se quedó sin servicio de verdad.
  // Escribir ahí la transición con su `origen` es lo que sustituye al estado `cortado` retirado.
  servicios_historial:        { dueno: 'contratos', infractores: ['promesas-pago', 'workers', 'outbox-red'] },
  promesas_pago:              { dueno: 'promesas-pago', infractores: ['outbox-red'] },
  tickets:                    { dueno: 'tickets',   infractores: ['portal', 'clientes'] },

  // ── Plataforma ─────────────────────────────────────────────────────────────
  auditoria_logs:  { dueno: 'auditoria', infractores: ['mantenimiento'] },
  entity_versions: { dueno: 'auditoria', infractores: ['common', 'mantenimiento'] },
  backups:         { dueno: 'backup',    infractores: ['mantenimiento', 'google-integration'] },
  eventos_sistema: { dueno: 'sistema' },
  watcher_heartbeat: { dueno: 'common' },

  // ── Red ────────────────────────────────────────────────────────────────────
  comandos_red_pendientes: {
    dueno: 'outbox-red',
    excepcion:
      'Excepción registrada en PA-12: los módulos de negocio ENCOLAN aquí para que la ' +
      'intención viaje dentro de su propia transacción — es el patrón outbox (ADR-002), y ' +
      'sacarlo de la transacción reintroduciría la pérdida de comandos que motivó el diseño. ' +
      'Corrección respecto al texto original de PA-12: `outbox-red` también ESCRIBE (reclamo ' +
      'atómico, estado, reintentos), no solo lee.',
  },
  ips_asignadas:  { dueno: 'mikrotik', infractores: ['smartolt'] },
  notificaciones_logs: {
    dueno: 'notificaciones',
    infractores: ['mensajeria', 'clientes', 'sistema', 'webhooks'],
  },
};

/** Tablas con más de un escritor hoy. Techo congelado por ADR-032: puede bajar, nunca subir. */
export const TECHO_TABLAS_COMPARTIDAS = 15;
