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
