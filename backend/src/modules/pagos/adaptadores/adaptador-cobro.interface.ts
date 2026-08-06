import { ResultadoOperacion } from '../../../common/domain/resultado-operacion';

/**
 * CONTRATO DEL ADAPTADOR DE COBRO — la frontera hacia las pasarelas (F7).
 *
 * Se define en la Etapa I aunque no exista todavía ninguna integración nueva. El motivo es
 * concreto: si se dejara para la Etapa II, **la primera integración lo definiría de facto**
 * y las demás se acomodarían a las peculiaridades de ese proveedor.
 *
 * MercadoPago —el único proveedor real que ya cobra dinero— es el caso de prueba de este
 * contrato. Una interfaz diseñada sin ninguna integración viva es una hipótesis, y la rompe
 * el primer proveedor. Si algo de aquí no encaja con MercadoPago, se corrige AQUÍ y ahora,
 * no cuando haya tres adaptadores encima.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLAS QUE TODO ADAPTADOR DEBE CUMPLIR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Un adaptador NO registra pagos.** Devuelve lo que el proveedor dijo; quien registra
 *    es el flujo de pagos. Si un adaptador tocara facturas, la frontera del dinero —que
 *    costó cuatro copias divergentes cerrar— volvería a tener puertas.
 *
 * 2. **`ResultadoOperacion`, nunca excepciones HTTP.** El transporte traduce en el borde.
 *    Un `409` no le dice a un reintentador automático si volver en cinco minutos o rendirse.
 *
 * 3. **`indeterminado` es OBLIGATORIO ante un timeout.** Un timeout cobrando NO significa
 *    "no pasó nada": al cliente pudo cobrársele y la respuesta pudo perderse. Ni se
 *    reintenta a ciegas —se le cobraría dos veces— ni se reporta como fallo —el dinero
 *    existiría sin registro—. Se reporta como "aceptado, sin confirmar" y lo resuelve el
 *    conciliador consultando al proveedor.
 *
 * 4. **El ID de la transacción del proveedor va en `referenciaExterna`**, y de ahí a
 *    `pagos.numero_operacion`. Es lo que hace idempotente un webhook reintentado — y todos
 *    los webhooks se reintentan, es su diseño. Esta regla se fija aquí, en el contrato, y
 *    no a criterio de cada integración: si cada una eligiera, la primera que se equivoque
 *    duplica cobros.
 *
 * 5. **Módulo degradable.** Toda pasarela implementa el patrón: probe en `onModuleInit`,
 *    registro en `moduleHealth`, y arranque igual si falla. La caja manual es Core
 *    Indestructible y NUNCA puede depender de que una pasarela responda.
 */

/** Lo que el proveedor dice de un intento de cobro. */
export interface ResultadoCobro {
  /**
   * ID de la transacción EN EL PROVEEDOR. Es la clave de idempotencia de todo lo que venga
   * después: webhooks reintentados, conciliación, extornos.
   */
  referenciaExterna: string | null;
  /** Bruto cobrado al abonado. Es lo que salda la factura — nunca el neto. */
  monto: number;
  /** Lo que retiene el proveedor. Es gasto, no un menor cobro. */
  comision: number;
  moneda: string;
  /** Payload crudo del proveedor, para poder auditar qué dijo exactamente. */
  detalle: Record<string, unknown>;
}

/** Un cobro que necesita que el abonado haga algo: pagar un link, escanear un QR. */
export interface CobroPendiente {
  referenciaExterna: string;
  /** A dónde mandar al abonado, si aplica. */
  urlPago?: string;
  /** Contenido del QR, si aplica. */
  qr?: string;
  expiraEn?: Date;
}

export interface SolicitudCobro {
  empresaId: string;
  clienteId: string;
  /** Comprobantes que este cobro salda. Consolidado = todo o nada. */
  facturaIds: string[];
  monto: number;
  moneda: string;
  descripcion: string;
  /**
   * Clave de idempotencia del ERP. Se envía al proveedor cuando lo soporta: es lo que
   * impide que un reintento de red genere dos cobros al abonado.
   */
  idempotencyKey: string;
}

/**
 * Un proveedor de cobro. Cada integración es una implementación independiente: añadir o
 * reemplazar un proveedor no puede obligar a tocar la lógica de negocio. Si un proveedor
 * lo obliga, el contrato estaba incompleto y se corrige aquí, no en el adaptador.
 */
export interface AdaptadorCobro {
  /** Identificador estable. Se corresponde con el `codigo` de un `canal_pago`. */
  readonly codigo: string;

  /** Nombre para la UI. */
  readonly nombre: string;

  /**
   * ¿Está operativo? Lo consulta el motor antes de ofrecer el medio. Un adaptador
   * degradado NO se ofrece: mejor no mostrar la opción que fallar tras el clic.
   */
  disponible(): Promise<boolean>;

  /**
   * Inicia el cobro. Devuelve `aplicado` si el proveedor confirmó en el acto (tarjeta),
   * o `reintentable` con un `CobroPendiente` si hace falta que el abonado actúe (link, QR).
   *
   * ANTE TIMEOUT: `indeterminado`. Nunca `rechazado_definitivo` — eso afirmaría que no se
   * cobró, y es exactamente lo que no se sabe.
   */
  iniciar(solicitud: SolicitudCobro): Promise<ResultadoOperacion & { cobro?: ResultadoCobro | CobroPendiente }>;

  /**
   * Consulta el estado real de un intento en el proveedor.
   *
   * Es la pieza que resuelve los `indeterminado` y los webhooks perdidos. Sin esto hay
   * dinero cobrado al abonado que el ERP nunca sabrá — y ese caso no lo reporta un log:
   * lo reporta el cliente, enfadado, semanas después.
   */
  consultar(referenciaExterna: string): Promise<ResultadoOperacion & { cobro?: ResultadoCobro }>;

  /**
   * Verifica la firma de un webhook. Obligatorio: un webhook sin verificar es un endpoint
   * público que crea pagos.
   */
  verificarFirma(cuerpoCrudo: Buffer, cabeceras: Record<string, string>): boolean;

  /**
   * Traduce el payload de un webhook a una referencia de transacción. El motor consulta
   * después con `consultar()` — nunca se confía en el importe que trae el webhook, porque
   * el webhook es un aviso, no una fuente de verdad.
   */
  referenciaDeWebhook(cuerpo: unknown): string | null;
}

/** Token de inyección para el registro de adaptadores disponibles. */
export const ADAPTADORES_COBRO = Symbol('ADAPTADORES_COBRO');
