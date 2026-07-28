import {
  HttpException,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

/**
 * Resultado de una operación de infraestructura, expresado en vocabulario de DOMINIO.
 *
 * Causa raíz que este tipo cierra (análisis 2026-07-28): los mismos métodos los consume
 * un humano (controller HTTP) y una máquina (outbox-red). Los guards se escribieron para
 * el primero y expresaban su veredicto con excepciones de NestJS — `BadRequestException`,
 * `ConflictException`. Para un operador frente a una pantalla eso es correcto. Para un
 * reintentador automático es ambiguo: un 409 puede significar "esto nunca va a funcionar"
 * o "vuelve en 5 minutos", y el status code NO lo distingue. El outbox terminaba haciendo
 * arqueología sobre códigos HTTP para decidir si reintentar, y se equivocaba:
 *
 *  - un no-op idempotente se leía como fallo → 1788 reintentos contra el MA5800 (4 días);
 *  - un 409 del lock de operación se leyó como veredicto definitivo → trabajo descartado.
 *
 * La regla: el dominio decide y lo dice explícitamente. El transporte traduce en el borde
 * (controller), nunca al revés.
 */
export type ResultadoOperacion =
  /** Ejecutado y con evidencia observable de que el cambio vive en el plano operativo (VIO). */
  | { clase: 'aplicado'; mensaje: string }
  /** El estado destino ya estaba alcanzado. Es ÉXITO: reejecutar una compensación ya aplicada no es un error. */
  | { clase: 'ya_en_destino'; mensaje: string }
  /** No había nada que hacer (contrato sin ONU, modo bridge). Éxito vacío. */
  | { clase: 'no_aplica'; mensaje: string }
  /** Veredicto definitivo del dominio: reintentar produce exactamente el mismo rechazo. */
  | { clase: 'rechazado_definitivo'; motivo: string }
  /** Fallo recuperable: lock ocupado, OLT caída, congestión. Reintentar es una obligación. */
  | { clase: 'reintentable'; motivo: string }
  /**
   * No se sabe si se aplicó. Timeout contra el hardware: la operación PUDO haberse
   * ejecutado y solo tardó más que el límite del cliente (incidente 2026-07-22).
   * Reintentar a ciegas es lo que ensucia el plano físico — exige verificar antes.
   */
  | { clase: 'indeterminado'; motivo: string };

/** Subconjunto de éxito: el trabajo está hecho y no queda nada por reintentar. */
export type ResultadoExitoso = Extract<
  ResultadoOperacion,
  { clase: 'aplicado' | 'ya_en_destino' | 'no_aplica' }
>;

/**
 * Clases que cuentan como éxito para quien orquesta. Es un type guard a propósito:
 * así el compilador obliga a tratar los tres casos de no-éxito por separado en el
 * llamador, en vez de dejarlos caer en un `else` genérico — que es como
 * `rechazado_definitivo` e `indeterminado` terminarían recibiendo el mismo trato.
 */
export function esExito(r: ResultadoOperacion): r is ResultadoExitoso {
  return r.clase === 'aplicado' || r.clase === 'ya_en_destino' || r.clase === 'no_aplica';
}

export function mensajeDe(r: ResultadoOperacion): string {
  return 'mensaje' in r ? r.mensaje : r.motivo;
}

/**
 * Traducción del dominio al TRANSPORTE, para el borde HTTP (controllers).
 *
 * Va aquí y no en el centro: el operador frente a una pantalla sí necesita que un
 * rechazo definitivo sea un 400 con su motivo. Lo que no puede pasar es que esa
 * traducción sea la única forma de expresar el veredicto — que es como el outbox
 * terminó adivinando a partir de status codes.
 *
 * `indeterminado` NO se traduce a error: se devuelve como "aceptado, sin confirmar",
 * que es exactamente la distinción que exige la regla VIO. Reportarlo como fallo
 * invitaría al operador a reintentar una operación que quizá ya se aplicó.
 */
export function traducirAHttp(
  r: ResultadoOperacion,
): { exitoso: boolean; mensaje: string; error?: string; clase: ResultadoOperacion['clase'] } {
  if (r.clase === 'rechazado_definitivo') {
    throw new BadRequestException(r.motivo);
  }
  if (r.clase === 'reintentable') {
    return { exitoso: false, mensaje: 'La operación no pudo aplicarse; se reintentará.', error: r.motivo, clase: r.clase };
  }
  if (r.clase === 'indeterminado') {
    return {
      exitoso: false,
      clase:   r.clase,
      mensaje: 'Aceptado, SIN CONFIRMAR: la operación pudo haberse aplicado en el hardware. Verifica el estado real antes de reintentar.',
      error:   r.motivo,
    };
  }
  return { exitoso: true, mensaje: r.mensaje, clase: r.clase };
}

/**
 * Traduce una excepción de las capas internas (que aún hablan HTTP) al vocabulario del
 * dominio. Es un ADAPTADOR de frontera, no la forma de expresar el dominio: el objetivo
 * es que los métodos nuevos devuelvan `ResultadoOperacion` directamente y este traductor
 * quede solo para el código heredado que todavía lanza.
 *
 * La lista de definitivos es EXPLÍCITA y corta a propósito. Un criterio amplio tipo
 * `status < 500` es incorrecto: el 409 del lock de operación significa "vuelve luego".
 * Ante la duda → reintentable, porque reintentar es recuperable y descartar no.
 */
export function clasificarError(err: unknown): ResultadoOperacion {
  const motivo = err instanceof Error ? err.message : String(err);

  // Timeout contra el hardware: PUEDE haberse aplicado. Se detecta por mensaje porque
  // el cliente del microservicio lo envuelve en un 503 igual que a "servicio caído",
  // y confundirlos invita a asumir que no pasó nada cuando el hardware sí quedó tocado.
  if (/timeout|tiempo de espera/i.test(motivo)) {
    return { clase: 'indeterminado', motivo };
  }

  if (err instanceof BadRequestException || err instanceof NotFoundException) {
    return { clase: 'rechazado_definitivo', motivo };
  }

  // Explícito aunque caiga en el default: deja constancia de que un 409 de lock es
  // transitorio por definición y de que se decidió así a conciencia.
  if (err instanceof ConflictException) {
    return { clase: 'reintentable', motivo };
  }

  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status === 400 || status === 404) return { clase: 'rechazado_definitivo', motivo };
    return { clase: 'reintentable', motivo };
  }

  return { clase: 'reintentable', motivo };
}
