import { FtthOnuEstado } from '../entities/ftth-onu-registro.entity';
import { ResultadoOperacion } from '../../../common/domain/resultado-operacion';

/**
 * Máquina de estados del registro FTTH — declarativa y en un solo lugar.
 *
 * Causa contribuyente identificada el 2026-07-28: los estados legales de cada operación
 * vivían en arrays y condicionales sueltos repartidos por el servicio (13 sitios). Nadie
 * podía leer la máquina completa, y por eso **faltaba un estado de origen sin que nadie
 * pudiera notarlo**: `desaprovisionar` no aceptaba `suspendido`, que es el caso más
 * frecuente del negocio (moroso suspendido al que se le da de baja). El resultado fue una
 * ONU huérfana en la OLT y 1603 reintentos inútiles contra el MA5800.
 *
 * Un criterio disperso no es auditable. Uno declarativo sí: la tabla de abajo se lee de
 * una vez y se revisa en un pull request.
 */
export type FtthTransicion =
  | 'suspender'
  | 'rehabilitar'
  | 'desaprovisionar'
  | 'cambiar_velocidad';

export interface DefinicionTransicion {
  /** Estados desde los que la transición es legal. */
  desde: FtthOnuEstado[];
  /**
   * Estado al que lleva. `null` = el recurso deja de existir (el registro se borra).
   * Sirve para DERIVAR la idempotencia en vez de implementarla a mano en cada método:
   * si el registro ya está en `hacia`, la operación es `ya_en_destino`.
   */
  hacia: FtthOnuEstado | null;
  /** Qué significa en términos de negocio. Aparece en el mensaje de rechazo. */
  descripcion: string;
}

export const FTTH_TRANSICIONES: Record<FtthTransicion, DefinicionTransicion> = {
  suspender: {
    desde:       [FtthOnuEstado.ACTIVO],
    hacia:       FtthOnuEstado.SUSPENDIDO,
    descripcion: 'Corte de servicio por mora (service-port abajo, ONU registrada)',
  },

  rehabilitar: {
    desde:       [FtthOnuEstado.SUSPENDIDO],
    hacia:       FtthOnuEstado.ACTIVO,
    descripcion: 'Reactivación tras pago',
  },

  desaprovisionar: {
    // `SUSPENDIDO` es de primera clase, no una excepción: la baja de un cliente moroso
    // —que ya está suspendido— es el camino más transitado del negocio. Omitirlo fue el
    // origen de la ONU huérfana del 24/07. Cualquier cambio a esta lista debe justificar
    // por qué un estado deja de poder darse de baja.
    desde: [
      FtthOnuEstado.ACTIVO,
      FtthOnuEstado.SUSPENDIDO,
      FtthOnuEstado.GPON_REGISTRADO,
      FtthOnuEstado.WAN_INYECTADO,
      FtthOnuEstado.FALLIDO_ROLLBACK, // permite forzar la limpieza manual además del watcher
    ],
    hacia:       null, // el registro se elimina
    descripcion: 'Baja definitiva: rollback GPON + liberación de pools + wipe ACS',
  },

  cambiar_velocidad: {
    desde:       [FtthOnuEstado.ACTIVO, FtthOnuEstado.SUSPENDIDO],
    hacia:       null, // conserva el estado actual: no es una transición de estado
    descripcion: 'Cambio de perfil de velocidad (line-profile / service-port)',
  },
};

/**
 * Evalúa una transición contra el estado actual ANTES de tocar el hardware.
 *
 * Devuelve `null` cuando la operación debe proceder. Cuando no, devuelve el
 * `ResultadoOperacion` que corresponde — en vocabulario de dominio, no HTTP:
 *
 *  - estado destino ya alcanzado → `ya_en_destino` (ÉXITO: reejecutar una compensación
 *    ya aplicada no es un error, directriz de wizards punto 8);
 *  - estado de origen ilegal     → `rechazado_definitivo` (reintentar da lo mismo).
 *
 * Que la idempotencia se DERIVE de `hacia` en vez de escribirse a mano en cada método
 * es el punto: un método nuevo no puede olvidarse de ser idempotente.
 */
export function evaluarTransicion(
  transicion: FtthTransicion,
  estadoActual: FtthOnuEstado,
): ResultadoOperacion | null {
  const def = FTTH_TRANSICIONES[transicion];

  if (def.hacia !== null && estadoActual === def.hacia) {
    return { clase: 'ya_en_destino', mensaje: `La ONU ya está en estado "${estadoActual}".` };
  }

  if (!def.desde.includes(estadoActual)) {
    return {
      clase:  'rechazado_definitivo',
      motivo:
        `No se puede ${transicion} desde el estado "${estadoActual}". ` +
        `${def.descripcion}. Estados válidos de origen: ${def.desde.join(', ')}.`,
    };
  }

  return null; // procede
}

/** Estados desde los que una transición es legal. Para tests y diagnóstico. */
export function origenesDe(transicion: FtthTransicion): FtthOnuEstado[] {
  return [...FTTH_TRANSICIONES[transicion].desde];
}
