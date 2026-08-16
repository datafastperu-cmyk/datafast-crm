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
// plantilla. Las escrituras vía repositorio TypeORM no se ven, y por eso `TECHO_TABLAS_COMPARTIDAS`
// es un SUELO, no un total: mide solo lo que la barrera puede medir. La foto más completa que hay
// hoy —`npm run inventario -- <bloque>`, que sí cruza ORM— encontró cinco tablas más con más de un
// escritor real (`onus`, `segmentos_ipv4`, `alertas_sistema`, `routers`, `usuarios`) y un escritor
// que faltaba en una ya declarada (`empresas` ← `config`). Se declaran en `infractoresConocidos`
// —ver la interfaz— en vez de fingir que no existen. Ampliar la barrera a ORM es Ola 6.
// ═══════════════════════════════════════════════════════════════════════════

export interface PropiedadTabla {
  /** Módulo que puede escribirla. Los demás la leen a través de él. */
  dueno: string;
  /**
   * Módulos que hoy la escriben sin ser el dueño, **detectados por la barrera** (SQL crudo en
   * backticks). **Es deuda declarada, no permiso.** Se enumeran para que la cifra esté
   * congelada: puede bajar, nunca subir. Cada uno se corrige cuando ese módulo se toque por
   * otra razón (alcance incremental, como VIO).
   */
  infractores?: string[];
  /**
   * Escritores reales que la barrera de este test **no puede ver**: ORM inyectado
   * (`this.xRepo.save()`) o SQL crudo fuera de backticks. Medidos con la foto más completa que
   * hay hoy — `npm run inventario -- <bloque>`, que sí cruza ORM — el 2026-08-16 (Ola 0). Es
   * deuda igual de real que `infractores`; **no cuenta** para `TECHO_TABLAS_COMPARTIDAS` porque
   * ese techo solo puede medir lo que la barrera ve. Ampliar la barrera a ORM es Ola 6 («un
   * dueño por tabla»); hasta entonces esto es la constancia escrita de que la deuda existe y no
   * se está fingiendo que no.
   */
  infractoresConocidos?: string[];
  /** Excepción justificada: no es deuda, es diseño. Exige motivo escrito. */
  excepcion?: string;
}

export const PROPIEDAD_TABLAS: Record<string, PropiedadTabla> = {
  // ── Core: el dinero y el abonado ───────────────────────────────────────────
  // El ACUERDO, creado en la fase 3b. Todavía no lo escribe nadie desde el código: lo pobló la
  // migración y su entidad llega con la fase 4. Se declara ya para que nazca con dueño — una
  // tabla sin declarar queda fuera del barrido de escritores y pierde la garantía en silencio.
  contratos: { dueno: 'contratos', infractores: [] },

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
  empresas: {
    dueno: 'sistema',
    infractores: ['backup'],
    // 'config' escribe timezone/config regional vía ORM (config-empresa.service.ts) — invisible
    // a la barrera SQL-cruda. Hallazgo de la Ola 0, no de hoy: ya escribía antes.
    infractoresConocidos: ['config'],
  },

  clientes_historial_estados: { dueno: 'clientes',  infractores: ['contratos', 'promesas-pago', 'workers'] },
  // 'outbox-red' entra el 2026-08-09 (fase 1): es quien aplica el corte por prórroga vencida en
  // el MikroTik, así que es el único que sabe cuándo el contrato se quedó sin servicio de verdad.
  // Escribir ahí la transición con su `origen` es lo que sustituye al estado `cortado` retirado.
  servicios_historial:        { dueno: 'contratos', infractores: ['promesas-pago', 'workers', 'outbox-red'] },
  promesas_pago:              { dueno: 'promesas-pago', infractores: ['outbox-red'] },
  tickets:                    { dueno: 'tickets',   infractores: ['portal', 'clientes'] },

  // ── Plataforma ─────────────────────────────────────────────────────────────
  auditoria_logs: {
    dueno: 'auditoria',
    infractores: ['mantenimiento'],
    // 'auth' y 'usuarios' registran su propio log de auditoría vía ORM (AuditoriaService.log,
    // UsuariosService) — invisibles a la barrera. Hallazgo Ola 0 (medición con techo ORM).
    infractoresConocidos: ['auth', 'usuarios'],
  },
  entity_versions: { dueno: 'auditoria', infractores: ['common', 'mantenimiento'] },
  backups:         { dueno: 'backup',    infractores: ['mantenimiento', 'google-integration'] },
  eventos_sistema: { dueno: 'sistema' },
  watcher_heartbeat: { dueno: 'common' },
  google_accounts: {
    dueno: 'google-integration',
    infractores: ['mantenimiento'], // limpieza de cuentas expiradas — DELETE en backticks, sí visible
  },
  google_sync_logs: {
    dueno: 'google-integration',
    infractores: ['mantenimiento'], // idem
  },

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
  ips_asignadas: {
    dueno: 'mikrotik',
    infractores: ['smartolt'],
    // 'clientes' (UPDATE al desvincular referido_por) y 'contratos' (IpPoolService, 3 sitios)
    // escriben vía ORM/SQL fuera de backticks — invisibles a la barrera.
    infractoresConocidos: ['clientes', 'contratos'],
  },
  vpn_clientes: {
    dueno: 'openvpn',
    infractores: ['mantenimiento'], // limpieza de certs huérfanos — UPDATE en backticks, sí visible
  },
  notificaciones_logs: {
    dueno: 'notificaciones',
    infractores: ['mensajeria', 'clientes', 'sistema', 'webhooks'],
  },
  routers: {
    dueno: 'mikrotik',
    infractoresConocidos: ['openvpn'], // vincula/desvincula el cert VPN sobre el router — ORM
  },
  segmentos_ipv4: {
    dueno: 'mikrotik',
    infractoresConocidos: ['contratos'], // IpPoolService reserva/libera IP — ORM
  },
  alertas_sistema: {
    dueno: 'monitoreo',
    infractoresConocidos: ['olt-nativo'], // alertas propias de OLT sobre la tabla general — ORM
  },

  // ── OLT / FTTH ─────────────────────────────────────────────────────────────
  // La entidad vive en modules/smartolt/entities/onu.entity.ts pero smartolt no la escribe hoy:
  // los tres sitios reales son contratos (1, SQL) y olt-nativo (3, ORM) — el dueño se declara
  // por quién escribe, no por dónde vive el fichero de entidad (inventario-bloque.ts §comentario).
  onus: {
    dueno: 'olt-nativo',
    infractores: ['contratos'], // UPDATE en SQL crudo, contratos.service.ts:1789 — la barrera lo ve
  },

  // ── Plataforma (cont.) ────────────────────────────────────────────────────
  // 'auth' escribe MÁS que el propio módulo (login, refresh, lockout) — vía ORM, invisible a la
  // barrera. 'install' es el único INSERT (SQL crudo, sí visible): siembra el primer admin en
  // la instalación limpia, una vez por instalación — bootstrap declarado, no deuda de negocio,
  // pero se declara igual porque el manifiesto es de escritores, no de intenciones.
  usuarios: {
    dueno: 'usuarios',
    infractores: ['install'],
    infractoresConocidos: ['auth'],
  },
};

/**
 * Tablas con más de un escritor hoy, **medidas con el instrumento barato** (SQL crudo en
 * backticks — `propiedad-tablas.spec.ts`, test «no sube del techo congelado»). Techo
 * congelado por ADR-032: puede bajar, nunca subir.
 *
 * NO es la única foto. Existe una segunda, más completa, con su propio techo: ver
 * `TECHO_TABLAS_COMPARTIDAS_ORM` más abajo. Que existan dos números para la misma realidad
 * está bien — dos instrumentos con precisión distinta—; que uno tape al otro no. Citar este
 * (15) como "el" techo de PA-12 sin decir cuál de los dos es una cita incompleta.
 */
export const TECHO_TABLAS_COMPARTIDAS = 15;

/**
 * Misma pregunta —¿cuántas tablas tienen más de un escritor?—, medida con el instrumento
 * completo: `escritoresPorTabla()` de `escritores-tabla.ts`, que ve SQL crudo en cualquier
 * parte del archivo y ORM inyectado, no solo backticks. Hallazgo Ola 0 (2026-08-16): son
 * **23**, no 15 — las 15 de siempre más `onus`, `segmentos_ipv4`, `alertas_sistema`,
 * `routers`, `usuarios`, `google_accounts`, `google_sync_logs` y `vpn_clientes`.
 *
 * La primera pasada de esta medición dio 24 y contenía un falso positivo: el patrón SQL sin
 * filtro leía `ON CONFLICT (...) DO UPDATE SET col = ...` (el upsert de Postgres) como una
 * escritura a una tabla `set`. Corregido en `escritores-tabla.ts` antes de congelar el
 * número — 23 es la cifra ya limpia, no la primera lectura cruda.
 *
 * Verificado por `propiedad-tablas.spec.ts` con el mismo mecanismo de ratchet que el techo
 * de arriba, y la misma regla ADR-032 §4.4: puede bajar, nunca subir sin ADR.
 */
export const TECHO_TABLAS_COMPARTIDAS_ORM = 23;
