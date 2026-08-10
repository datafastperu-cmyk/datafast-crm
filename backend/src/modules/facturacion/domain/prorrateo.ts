/**
 * Prorrateo — la ÚNICA definición del repositorio.
 *
 * Política vinculante: **PD-14** en `docs/gobierno/POL-001-politicas-corporativas.md`.
 * Razonamiento y versiones descartadas: `docs/estudio/catalogo-servicios-notas.md` §7-ter.
 *
 * ```
 * importe = REDONDEAR( precio_mensual × días_facturables / 30 )
 * ```
 *
 * Base `ACTUAL_360`: días de calendario **reales** en el numerador, **30 comerciales** en el
 * denominador. NO es 30/360 —esa cuenta también el numerador en meses de 30 días y da otros
 * importes—; el nombre correcto evita que alguien implemente la otra creyendo que es la misma.
 *
 * Es una política **comercial de Datafast**, no una norma: OSIPTEL regula el ciclo de facturación
 * y que se facture lo efectivamente prestado, y contempla el cobro proporcional, pero no impone
 * una base de prorrateo. Se eligió porque la **tarifa diaria es constante todo el año**, que es lo
 * que se le explica a un abonado por teléfono.
 */

/** Etiqueta de la base. Se persiste en el ítem para que un cargo viejo siga siendo reconstruible. */
export const BASE_PRORRATEO = 'ACTUAL_360' as const;

/** Denominador comercial. Se persiste junto a la base: la etiqueta sola sería ambigua. */
export const DENOMINADOR_PRORRATEO = 30;

export type TipoCargo = 'completo' | 'prorrateado';

export interface CargoDelPeriodo {
  /** `completo` = el ciclo entero, a tarifa plana. `prorrateado` = tramo parcial. */
  tipo: TipoCargo;
  /** Importe final, redondeado a dos decimales. Es el único valor que se cobra. */
  importe: number;
  /** Días facturables del tramo. En un cargo completo, los del ciclo. */
  dias: number;
  base: typeof BASE_PRORRATEO;
  denominador: number;
  /**
   * Tarifa diaria, **informativa**. Existe para que el recibo se explique
   * («21 días × S/ 2,6667»). Nunca se usa para recalcular `importe`: recalcular desde seis
   * decimales produce discrepancias de un céntimo entre dos partes del ERP, y ninguna manda.
   */
  tarifaDiaria: number;
}

/**
 * Días de calendario entre dos fechas, **ambos extremos incluidos**.
 *
 * Un día con servicio es un día facturable: cuenta el día de instalación —con activación matutina
 * son catorce horas— y cuenta el día del corte, por lo mismo. Es una sola regla aplicada a los dos
 * extremos; si solo se aplicara a uno, el abonado pagaría dos veces el día del cambio o ninguna
 * de las dos.
 */
export const diasFacturables = (inicio: Date, fin: Date): number => {
  const MS_POR_DIA = 86_400_000;
  const a = Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate());
  const b = Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate());
  return Math.floor((b - a) / MS_POR_DIA) + 1;
};

/**
 * Redondeo a dos decimales, **una sola vez y al final**.
 *
 * Se opera en céntimos enteros en vez de `Math.round(x * 100) / 100` sobre el cociente ya
 * calculado: encadenar dos operaciones en coma flotante antes de redondear desplaza el céntimo en
 * los importes que caen justo en el medio.
 */
const aCentimos = (precioMensual: number, dias: number): number =>
  Math.round((precioMensual * dias * 100) / DENOMINADOR_PRORRATEO);

/**
 * Cargo que corresponde a un periodo, sea completo o parcial.
 *
 * **Es el único punto de entrada, y es deliberado.** La regla del ciclo completo no se puede
 * olvidar porque no la implementa quien llama: si los días entregados son todos los del ciclo, el
 * importe es el precio mensual íntegro, sin pasar por la división. Exponer el prorrateo suelto
 * dejaría que alguien cobrara `31 × precio/30` —el 103 % de la mensualidad— sin darse cuenta. Es
 * el mismo criterio con el que `estados-con-saldo.ts` esconde el SQL crudo tras `sqlDeudaExigible`:
 * la forma incorrecta no debe ser expresable.
 *
 * @param precioMensual  precio del periodo completo, ya con el descuento del contrato aplicado
 * @param diasDelCiclo   duración del ciclo, de `periodoServicio` — varía entre 28 y 31
 * @param diasEntregados días en que el servicio estuvo activo dentro del ciclo
 */
export const cargoDelPeriodo = (
  precioMensual: number,
  diasDelCiclo: number,
  diasEntregados: number,
): CargoDelPeriodo => {
  if (diasDelCiclo <= 0) {
    throw new Error(`prorrateo: diasDelCiclo debe ser positivo, llegó ${diasDelCiclo}`);
  }
  if (diasEntregados < 0 || diasEntregados > diasDelCiclo) {
    throw new Error(
      `prorrateo: diasEntregados (${diasEntregados}) fuera del ciclo de ${diasDelCiclo} días`,
    );
  }

  const comun = {
    base:         BASE_PRORRATEO,
    denominador:  DENOMINADOR_PRORRATEO,
    tarifaDiaria: Math.round((precioMensual / DENOMINADOR_PRORRATEO) * 1e6) / 1e6,
  };

  // Ciclo completo: tarifa plana, dure 28 o 31 días. El abonado de febrero paga lo mismo que el
  // de marzo. Aquí es donde el tope del 103 % deja de hacer falta.
  if (diasEntregados === diasDelCiclo) {
    return { ...comun, tipo: 'completo', importe: precioMensual, dias: diasEntregados };
  }

  return {
    ...comun,
    tipo:    'prorrateado',
    importe: aCentimos(precioMensual, diasEntregados) / 100,
    dias:    diasEntregados,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// DÍAS ENTREGADOS — H-6 y H-8 (2026-08-09)
//
// La generación mensual decidía con **el estado de hoy** lo que debía decidir con **el
// tiempo entregado**: filtraba `estado = 'activo'`, así que un contrato suspendido no
// entraba. En postpago eso dejaba sin cobrar el tramo previo al corte —ocho días de
// servicio real que no se recuperaban nunca, porque el siguiente comprobante ya cubría el
// mes siguiente—. En prepago dejaba sin emitir el ciclo posterior a la reactivación.
//
// Aquí vive la otra mitad de la respuesta: cuántos días de un ciclo estuvo el servicio
// realmente activo. El importe lo pone `cargoDelPeriodo`.
// ═══════════════════════════════════════════════════════════════════════════

export interface TransicionEstado {
  /** Día en que el contrato pasó a `estadoNuevo`, en la zona horaria del operador. */
  fecha: Date;
  estadoNuevo: string;
}

const ESTADO_CON_SERVICIO = 'activo';

const mismoDia = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth()    === b.getUTCMonth() &&
  a.getUTCDate()     === b.getUTCDate();

/**
 * Días del ciclo en que el servicio estuvo activo.
 *
 * **Un día con servicio es un día facturable** (PD-14): si el contrato estuvo activo en
 * algún momento del día, ese día cuenta entero. Por eso cuenta el día del corte —hubo
 * servicio hasta que se cortó— y el de la reactivación.
 *
 * Se recorre día a día en vez de restar fechas. Son 31 iteraciones como mucho, y a cambio
 * el caso de varias transiciones en el mismo día —suspender y reactivar la misma tarde—
 * sale bien sin aritmética de intervalos que revisar.
 *
 * **El último estado conocido se extiende hasta el final del ciclo**, y eso es deliberado:
 * el postpago se emite unos días ANTES de que el ciclo termine (`diasAntesEmision`), así
 * que hay que facturar suponiendo que no habrá más cambios. Si los hay, el ciclo siguiente
 * los recoge. Sin esto, a un abonado activo se le facturarían solo los días transcurridos.
 *
 * @param estadoAlInicio estado vigente el primer día del ciclo
 * @param transiciones   cambios de estado DENTRO del ciclo, en orden cronológico
 */
export const diasEntregados = (
  estadoAlInicio: string,
  transiciones: TransicionEstado[],
  inicio: Date,
  fin: Date,
): number => {
  let estado = estadoAlInicio;
  let pendientes = 0;
  let dias = 0;

  const cursor = new Date(Date.UTC(
    inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate(),
  ));
  const ultimo = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate()));

  while (cursor <= ultimo) {
    // Hubo servicio si ya estaba activo al empezar el día...
    let conServicio = estado === ESTADO_CON_SERVICIO;

    // ...o si alguna transición de ESE día lo puso activo, aunque después volviera a salir.
    while (pendientes < transiciones.length && mismoDia(transiciones[pendientes].fecha, cursor)) {
      estado = transiciones[pendientes].estadoNuevo;
      if (estado === ESTADO_CON_SERVICIO) conServicio = true;
      pendientes++;
    }

    if (conServicio) dias++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dias;
};
