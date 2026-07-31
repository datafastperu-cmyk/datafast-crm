import { ResultadoOperacion } from '../../../common/domain/resultado-operacion';

/**
 * Máquina de estados de la planta externa FTTH — declarativa y en un solo lugar.
 *
 * Se escribe ANTES que el esquema y que el servicio, a propósito. La directriz de
 * "máquina de estados declarativa" nació del análisis 2026-07-28: los estados legales
 * vivían en arrays y condicionales sueltos repartidos por el servicio (13 sitios), y por
 * eso faltaba un estado de origen sin que nadie pudiera notarlo. Si esta máquina naciera
 * después del CRUD, los guards ya estarían dispersos y la regla se incumpliría desde el
 * primer commit.
 *
 * Aquí viven DOS máquinas, porque son dos ciclos de vida distintos:
 *
 *  1. `ElementoEstado`  — mufas, NAPs, segmentos y splitters (el activo físico).
 *  2. `PuertoEstado`    — los puertos de una NAP (el recurso asignable).
 *
 * Los enums viven en este archivo y no en las entidades: las entidades los importan. Así
 * el dominio no depende de TypeORM y esta máquina es testeable sin base de datos.
 */

// ─────────────────────────────────────────────────────────────────────
// 1. Ciclo de vida del ELEMENTO físico (mufa, NAP, segmento, splitter)
// ─────────────────────────────────────────────────────────────────────

export enum ElementoEstado {
  /** Proyectado en el plano. Todavía NO existe en la calle. */
  PLANIFICADO = 'planificado',
  /** Instalado físicamente, sin dar servicio aún (sin fusionar / sin splitter). */
  INSTALADO = 'instalado',
  /** En servicio. */
  OPERATIVO = 'operativo',
  /** Fuera de servicio por falla física (cable cortado, caja rota). */
  AVERIADO = 'averiado',
  /** Desmontado o abandonado. Estado terminal — se conserva por trazabilidad histórica. */
  RETIRADO = 'retirado',
}

/**
 * No existe un estado `degradado` intermedio a propósito, aunque el borrador de la
 * propuesta lo contemplaba. En planta externa no hay telemetría que distinga "degradado"
 * de "averiado" en una mufa o un tendido: lo decidiría un humano por corazonada. Un estado
 * que nadie sabe cuándo poner es un estado que se llena mal, y después se razona sobre él
 * como si significara algo. La degradación real —una fusión sucia, una curvatura— se
 * detecta por el presupuesto óptico (Fase 3), que sí es una medición, y se reporta como
 * alerta sobre un elemento que sigue `OPERATIVO`.
 */

export type ElementoTransicion =
  | 'instalar'
  | 'activar'
  | 'averiar'
  | 'reparar'
  | 'retirar';

export interface DefinicionTransicion<E extends string> {
  /** Estados desde los que la transición es legal. */
  desde: E[];
  /**
   * Estado al que lleva. `null` = no es una transición de estado (conserva el actual).
   * Sirve para DERIVAR la idempotencia en vez de implementarla a mano en cada método:
   * si el recurso ya está en `hacia`, la operación es `ya_en_destino` (ÉXITO).
   */
  hacia: E | null;
  /** Qué significa en términos de negocio. Aparece en el mensaje de rechazo. */
  descripcion: string;
}

export const ELEMENTO_TRANSICIONES: Record<
  ElementoTransicion,
  DefinicionTransicion<ElementoEstado>
> = {
  instalar: {
    desde:       [ElementoEstado.PLANIFICADO],
    hacia:       ElementoEstado.INSTALADO,
    descripcion: 'El elemento se montó en campo pero todavía no presta servicio',
  },

  activar: {
    // PLANIFICADO es origen legal de primera clase, no un atajo: la planta existente
    // se documenta hacia atrás. Un técnico que carga una mufa instalada hace tres años
    // no debe verse obligado a simular un paso por "instalado" que nunca ocurrió en el
    // ERP. Forzar el camino largo es lo que hace que la gente ponga datos falsos.
    desde:       [ElementoEstado.PLANIFICADO, ElementoEstado.INSTALADO],
    hacia:       ElementoEstado.OPERATIVO,
    descripcion: 'El elemento entra en servicio (fusionado / con splitter / energizado)',
  },

  averiar: {
    desde:       [ElementoEstado.OPERATIVO, ElementoEstado.INSTALADO],
    hacia:       ElementoEstado.AVERIADO,
    descripcion: 'Falla física: cable cortado, caja destruida, splitter quemado',
  },

  reparar: {
    desde:       [ElementoEstado.AVERIADO],
    hacia:       ElementoEstado.OPERATIVO,
    descripcion: 'Falla resuelta, vuelve a prestar servicio',
  },

  retirar: {
    // Desde cualquier estado no terminal. Un proyecto cancelado (PLANIFICADO) y una caja
    // destruida (AVERIADO) se retiran igual que una operativa; obligarlas a pasar por
    // OPERATIVO primero sería inventar un hecho que no ocurrió.
    desde: [
      ElementoEstado.PLANIFICADO,
      ElementoEstado.INSTALADO,
      ElementoEstado.OPERATIVO,
      ElementoEstado.AVERIADO,
    ],
    hacia:       ElementoEstado.RETIRADO,
    descripcion: 'Desmontaje o abandono definitivo del elemento',
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. Ciclo de vida del PUERTO de una NAP (el recurso asignable)
// ─────────────────────────────────────────────────────────────────────

export enum PuertoEstado {
  /**
   * El adaptador físico existe en la caja, pero NO hay salida de splitter detrás.
   * Es el estado inicial de todos los puertos al dar de alta la NAP.
   *
   * Existe porque capacidad de caja y capacidad de splitter son cosas distintas: una NAP
   * de 16 con un solo 1x8 tiene 8 puertos que se ven y se tocan pero no dan servicio. El
   * expediente los contaba como libres, y con eso el planificador ve capacidad donde no
   * puede conectar a nadie. Se habilitan al instalar el segundo splitter.
   */
  NO_HABILITADO = 'no_habilitado',
  /** Con salida de splitter conectada y sin cliente. Asignable. */
  LIBRE = 'libre',
  /** Retenido por un wizard de alta en curso. Se libera solo al vencer el TTL. */
  RESERVADO = 'reservado',
  /** Con acometida de cliente. */
  OCUPADO = 'ocupado',
  /** Adaptador roto o salida de splitter quemada. */
  AVERIADO = 'averiado',
  /** El puerto dejó de existir (se retiró la caja). Estado terminal. */
  RETIRADO = 'retirado',
}

export type PuertoTransicion =
  | 'habilitar'
  | 'deshabilitar'
  | 'reservar'
  | 'ocupar'
  | 'liberar'
  | 'averiar'
  | 'reparar'
  | 'retirar';

export const PUERTO_TRANSICIONES: Record<
  PuertoTransicion,
  DefinicionTransicion<PuertoEstado>
> = {
  habilitar: {
    desde:       [PuertoEstado.NO_HABILITADO],
    hacia:       PuertoEstado.LIBRE,
    descripcion: 'Se instaló un splitter y una de sus salidas quedó conectada a este puerto',
  },

  deshabilitar: {
    // Sólo desde LIBRE. Retirar un splitter cuyas salidas alimentan puertos OCUPADOS debe
    // fallar, no vaciarlos en cascada: eso borraría la trazabilidad de clientes que siguen
    // conectados. El guard vive aquí para que ningún método futuro pueda saltárselo.
    desde:       [PuertoEstado.LIBRE, PuertoEstado.AVERIADO],
    hacia:       PuertoEstado.NO_HABILITADO,
    descripcion: 'Se retiró el splitter que alimentaba este puerto',
  },

  reservar: {
    desde:       [PuertoEstado.LIBRE],
    hacia:       PuertoEstado.RESERVADO,
    descripcion: 'Retención temporal durante un wizard de alta (TTL corto)',
  },

  ocupar: {
    // `hacia: null` a propósito, aunque la transición SÍ lleva a OCUPADO.
    //
    // La idempotencia derivada diría "ya está OCUPADO → ya_en_destino (éxito)", y eso sería
    // un falso éxito peligroso: el puerto puede estar ocupado por OTRO contrato. Quien
    // decide es el servicio, que sí sabe de quién es la acometida — si el dueño es el mismo
    // contrato devuelve `ya_en_destino`, y si es otro, `rechazado_definitivo`.
    //
    // Es exactamente el patrón del incidente 2026-07-28 al revés: allí un no-op idempotente
    // se leyó como fallo; aquí un fallo se leería como no-op idempotente. Ninguna máquina
    // puede derivar esto sin conocer al dueño, así que no lo finge.
    desde:       [PuertoEstado.LIBRE, PuertoEstado.RESERVADO],
    hacia:       null,
    descripcion: 'Asignación de la acometida de un cliente',
  },

  liberar: {
    desde:       [PuertoEstado.RESERVADO, PuertoEstado.OCUPADO],
    hacia:       PuertoEstado.LIBRE,
    descripcion: 'Baja de la acometida o expiración de la reserva del wizard',
  },

  averiar: {
    desde:       [PuertoEstado.LIBRE, PuertoEstado.RESERVADO, PuertoEstado.OCUPADO],
    hacia:       PuertoEstado.AVERIADO,
    descripcion: 'Adaptador roto o salida de splitter quemada',
  },

  reparar: {
    // Vuelve a LIBRE, nunca a OCUPADO: reparar un puerto no reconecta al cliente que
    // estaba ahí. Si el cliente vuelve, es una acometida nueva y queda auditada como tal.
    desde:       [PuertoEstado.AVERIADO],
    hacia:       PuertoEstado.LIBRE,
    descripcion: 'Puerto reparado, vuelve a estar disponible',
  },

  retirar: {
    desde: [
      PuertoEstado.NO_HABILITADO,
      PuertoEstado.LIBRE,
      PuertoEstado.RESERVADO,
      PuertoEstado.AVERIADO,
    ],
    hacia:       PuertoEstado.RETIRADO,
    descripcion: 'El puerto deja de existir porque se retiró la caja',
  },
};

/**
 * OCUPADO no puede retirarse: retirar una caja con clientes colgando es exactamente la
 * discordancia físico↔lógico que el ERP existe para evitar. Primero se dan de baja o se
 * migran las acometidas; recién entonces se retira el puerto. Se declara como constante
 * en vez de comentario suelto para que el test pueda ejercitarlo.
 */
export const PUERTO_NO_RETIRABLE: readonly PuertoEstado[] = [PuertoEstado.OCUPADO];

// ─────────────────────────────────────────────────────────────────────
// 3. Evaluación
// ─────────────────────────────────────────────────────────────────────

/**
 * Núcleo compartido por las dos máquinas. Devuelve `null` cuando la operación procede.
 *
 *  - estado destino ya alcanzado → `ya_en_destino` (ÉXITO: reejecutar algo ya aplicado
 *    no es un error — directriz de wizards, punto 8);
 *  - estado de origen ilegal     → `rechazado_definitivo` (reintentar da lo mismo).
 *
 * Que la idempotencia se DERIVE de `hacia` en vez de escribirse a mano en cada método es
 * el punto entero: un método nuevo no puede olvidarse de ser idempotente si no es él quien
 * la implementa.
 */
function evaluar<E extends string>(
  nombreTransicion: string,
  def: DefinicionTransicion<E>,
  estadoActual: E,
  sujeto: string,
): ResultadoOperacion | null {
  if (def.hacia !== null && estadoActual === def.hacia) {
    return {
      clase:   'ya_en_destino',
      mensaje: `${sujeto} ya está en estado "${estadoActual}".`,
    };
  }

  if (!def.desde.includes(estadoActual)) {
    return {
      clase:  'rechazado_definitivo',
      motivo:
        `No se puede ${nombreTransicion} ${sujeto.toLowerCase()} desde el estado ` +
        `"${estadoActual}". ${def.descripcion}. ` +
        `Estados válidos de origen: ${def.desde.join(', ')}.`,
    };
  }

  return null; // procede
}

/** Evalúa una transición del elemento físico ANTES de tocar la base de datos. */
export function evaluarTransicionElemento(
  transicion: ElementoTransicion,
  estadoActual: ElementoEstado,
  sujeto = 'El elemento',
): ResultadoOperacion | null {
  return evaluar(transicion, ELEMENTO_TRANSICIONES[transicion], estadoActual, sujeto);
}

/** Evalúa una transición de un puerto de NAP ANTES de tocar la base de datos. */
export function evaluarTransicionPuerto(
  transicion: PuertoTransicion,
  estadoActual: PuertoEstado,
  sujeto = 'El puerto',
): ResultadoOperacion | null {
  return evaluar(transicion, PUERTO_TRANSICIONES[transicion], estadoActual, sujeto);
}

/** Estados desde los que una transición de elemento es legal. Para tests y diagnóstico. */
export function origenesElemento(transicion: ElementoTransicion): ElementoEstado[] {
  return [...ELEMENTO_TRANSICIONES[transicion].desde];
}

/** Estados desde los que una transición de puerto es legal. Para tests y diagnóstico. */
export function origenesPuerto(transicion: PuertoTransicion): PuertoEstado[] {
  return [...PUERTO_TRANSICIONES[transicion].desde];
}

/**
 * Estados de puerto que cuentan como "ocupa capacidad de splitter".
 * Un puerto RESERVADO consume capacidad aunque todavía no tenga cliente: si no contara,
 * dos wizards simultáneos podrían sobre-suscribir la caja.
 */
export const PUERTO_CONSUME_CAPACIDAD: readonly PuertoEstado[] = [
  PuertoEstado.RESERVADO,
  PuertoEstado.OCUPADO,
];
