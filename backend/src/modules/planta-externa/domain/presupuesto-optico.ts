/**
 * Presupuesto óptico de un enlace GPON.
 *
 * Es lo que convierte la planta documentada en una herramienta de diagnóstico: con la
 * pérdida TEÓRICA del camino se puede contrastar la potencia REAL que reporta la ONU y
 * detectar una fusión sucia, una curvatura o un conector mal pulido sin subir a un poste.
 *
 * Todas las constantes viven aquí y no dispersas en el servicio: son valores de ingeniería
 * que un jefe de planta puede querer ajustar por proveedor, y buscarlos en cinco archivos
 * distintos es cómo se acaban desincronizando.
 */

/**
 * Pérdida por conector, en dB. Se cuentan los del extremo: el de la caja NAP y el de la
 * roseta del cliente. Los conectores intermedios de una mufa no existen —ahí hay fusiones,
 * no conectores— y contarlos inflaría el presupuesto.
 */
export const PERDIDA_CONECTOR_DB = 0.3;
export const CONECTORES_POR_ENLACE = 2;

/**
 * Margen de seguridad, en dB. La suma teórica siempre es optimista: no incluye
 * envejecimiento de la fibra, empalmes de reparación futuros ni la tolerancia del propio
 * transceptor. Sin margen, un enlace calculado "justo" nace condenado.
 */
export const MARGEN_SEGURIDAD_DB = 3.0;

/**
 * Desviación a partir de la cual la medición real se considera anómala.
 *
 * Por debajo de esto, la diferencia entre teoría y realidad se explica por tolerancias
 * normales: la potencia de transmisión del puerto PON varía entre equipos, la atenuación
 * declarada del cable es nominal y las longitudes se estiman. Marcar cada 1 dB de
 * diferencia generaría tantas alertas que nadie las miraría.
 */
export const DESVIACION_ALERTA_DB = 3.0;

/** Sensibilidad típica de una ONU GPON clase B+. Por debajo de esto, no sincroniza. */
export const SENSIBILIDAD_ONU_DBM = -27.0;

/** Potencia típica de transmisión de un puerto PON clase B+. */
export const POTENCIA_TX_OLT_DBM = 3.0;

export interface ComponentePerdida {
  tipo: 'fibra' | 'splitter' | 'fusion' | 'conector';
  descripcion: string;
  perdidaDb: number;
}

export interface Presupuesto {
  componentes: ComponentePerdida[];
  /** Suma de todas las pérdidas, sin margen. */
  perdidaTotalDb: number;
  /** Potencia que DEBERÍA llegar a la ONU: TX de la OLT menos las pérdidas. */
  potenciaEsperadaDbm: number;
  /** `perdidaTotal + margen` contra el presupuesto disponible del enlace. */
  dentroDePresupuesto: boolean;
  margenRestanteDb: number;
}

/** Pérdida de un tramo de fibra. La atenuación es por kilómetro; la longitud, en metros. */
export function perdidaFibra(longitudM: number, atenuacionDbKm: number): number {
  return (longitudM / 1000) * atenuacionDbKm;
}

/**
 * Consolida los componentes en un veredicto.
 *
 * `potenciaEsperadaDbm` es el número que después se compara contra el `rx_power_dbm` real
 * de la ONU. La comparación NO se hace aquí a propósito: este módulo calcula teoría pura y
 * es determinista; mezclarlo con la lectura del hardware lo volvería intestable sin una OLT.
 */
export function consolidar(componentes: ComponentePerdida[]): Presupuesto {
  const perdidaTotalDb = Number(
    componentes.reduce((acc, c) => acc + c.perdidaDb, 0).toFixed(2),
  );

  const potenciaEsperadaDbm = Number((POTENCIA_TX_OLT_DBM - perdidaTotalDb).toFixed(2));

  // El presupuesto disponible es la diferencia entre lo que emite la OLT y lo mínimo que
  // la ONU necesita para sincronizar. Lo que sobre tras descontar pérdidas y margen es lo
  // que queda para envejecimiento y reparaciones futuras.
  const presupuestoDisponible = POTENCIA_TX_OLT_DBM - SENSIBILIDAD_ONU_DBM;
  const margenRestanteDb = Number(
    (presupuestoDisponible - perdidaTotalDb - MARGEN_SEGURIDAD_DB).toFixed(2),
  );

  return {
    componentes,
    perdidaTotalDb,
    potenciaEsperadaDbm,
    dentroDePresupuesto: margenRestanteDb >= 0,
    margenRestanteDb,
  };
}

export type VeredictoMedicion =
  | { clase: 'sin_medicion'; mensaje: string }
  | { clase: 'coherente'; desviacionDb: number; mensaje: string }
  | { clase: 'anomalia'; desviacionDb: number; mensaje: string };

/**
 * Contrasta la potencia REAL de la ONU contra la esperada.
 *
 * Distingue tres casos y no dos, porque "no hay medición" no es lo mismo que "coincide":
 * un contrato sin lectura óptica no valida nada, y reportarlo como correcto sería
 * exactamente el `success: true` sin comprobar que la regla VIO existe para impedir.
 *
 * Una potencia MEJOR que la esperada también es anómala, aunque suene bien: significa que
 * el camino documentado tiene más pérdidas de las que la fibra realmente atraviesa — casi
 * siempre, que el cliente no está conectado por donde dice el ERP.
 */
export function contrastarConMedicion(
  potenciaEsperadaDbm: number,
  rxPowerDbm: number | null | undefined,
): VeredictoMedicion {
  if (rxPowerDbm == null) {
    return {
      clase: 'sin_medicion',
      mensaje: 'Sin lectura óptica de la ONU: el cálculo no está contrastado con la realidad.',
    };
  }

  const desviacionDb = Number((rxPowerDbm - potenciaEsperadaDbm).toFixed(2));

  if (Math.abs(desviacionDb) <= DESVIACION_ALERTA_DB) {
    return {
      clase: 'coherente',
      desviacionDb,
      mensaje: `La medición coincide con el cálculo (${desviacionDb >= 0 ? '+' : ''}${desviacionDb} dB).`,
    };
  }

  return {
    clase: 'anomalia',
    desviacionDb,
    mensaje:
      desviacionDb < 0
        ? `La ONU recibe ${Math.abs(desviacionDb)} dB MENOS de lo calculado. Revisa fusiones, ` +
          `curvaturas o conectores sucios en el camino.`
        : `La ONU recibe ${desviacionDb} dB MÁS de lo calculado. El camino documentado ` +
          `probablemente no es el real: verifica por qué NAP y puerto está conectada.`,
  };
}
