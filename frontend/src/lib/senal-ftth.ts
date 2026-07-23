// ─────────────────────────────────────────────────────────────
// Clasificación de la señal óptica FTTH (potencia Rx de la ONU, en dBm).
//
// Umbrales basados en el estándar GPON ITU-T G.984 (óptica Class B+), que es el rango de
// operación real del receptor de la ONU:
//   · Sensibilidad (mínimo):  -28 dBm  → por debajo, la ONU deja de sincronizar
//   · Sobrecarga (máximo):     -8 dBm  → por encima, exceso de luz (ONU demasiado cerca)
//
// La señal es MALA por ambos extremos: demasiado débil (se cae el enlace) o demasiado fuerte
// (satura el receptor). Se deja un margen de guarda sobre los límites duros del estándar.
//
//   Muy Buena (verde):    -8 dBm ≥ Rx ≥ -25 dBm   (zona óptima de operación)
//   Buena     (amarillo): -25 dBm > Rx ≥ -27 dBm   (débil pero funcional; vigilar)
//   Baja      (rojo):      Rx < -27 dBm (al borde de sensibilidad)  ó  Rx > -8 dBm (sobrecarga)
// ─────────────────────────────────────────────────────────────

export type NivelSenalFtth = 'muy_buena' | 'buena' | 'baja' | 'desconocida';

export interface SenalFtthClasificada {
  nivel:      NivelSenalFtth;
  label:      string;
  /** Clase Tailwind de texto/estado para pintar el valor. */
  colorCls:   string;
  /** Clase Tailwind para un badge/pill (texto + borde + fondo). */
  badgeCls:   string;
  /** Motivo cuando es baja: 'debil' | 'sobrecarga' | null. */
  motivo:     'debil' | 'sobrecarga' | null;
}

const UMBRAL_MUY_BUENA = -25; // Rx ≥ -25  → óptima
const UMBRAL_BUENA     = -27; // -27 ≤ Rx < -25 → aceptable
const UMBRAL_SOBRECARGA = -8; // Rx > -8   → demasiada luz

export function clasificarSenalFtth(rxDbm?: number | null): SenalFtthClasificada {
  if (rxDbm == null || Number.isNaN(rxDbm)) {
    return {
      nivel: 'desconocida', label: 'Sin dato', motivo: null,
      colorCls: 'text-muted-foreground',
      badgeCls: 'text-muted-foreground border-border bg-muted/30',
    };
  }

  // Sobrecarga: demasiada potencia (ONU demasiado cerca de la OLT / sin atenuador).
  if (rxDbm > UMBRAL_SOBRECARGA) {
    return {
      nivel: 'baja', label: 'Baja (sobrecarga)', motivo: 'sobrecarga',
      colorCls: 'text-red-500',
      badgeCls: 'text-red-400 border-red-700/50 bg-red-500/10',
    };
  }
  // Muy buena: dentro de la zona óptima.
  if (rxDbm >= UMBRAL_MUY_BUENA) {
    return {
      nivel: 'muy_buena', label: 'Muy Buena', motivo: null,
      colorCls: 'text-emerald-500',
      badgeCls: 'text-emerald-400 border-emerald-700/50 bg-emerald-500/10',
    };
  }
  // Buena: débil pero funcional.
  if (rxDbm >= UMBRAL_BUENA) {
    return {
      nivel: 'buena', label: 'Buena', motivo: null,
      colorCls: 'text-amber-500',
      badgeCls: 'text-amber-400 border-amber-700/50 bg-amber-500/10',
    };
  }
  // Baja: al borde de la sensibilidad del receptor.
  return {
    nivel: 'baja', label: 'Baja (débil)', motivo: 'debil',
    colorCls: 'text-red-500',
    badgeCls: 'text-red-400 border-red-700/50 bg-red-500/10',
  };
}
