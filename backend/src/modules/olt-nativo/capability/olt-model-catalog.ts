// ─────────────────────────────────────────────────────────────
// Catálogo de modelos de OLT soportados por el ERP.
//
// Huawei NO uniformiza el comportamiento del firmware entre modelos
// (comprobado en producción: 'display traffic table all' no existe en
// MA5800V100R018C00, la doc genérica VRP no aplica 1:1). Por eso el
// soporte se declara por MODELO y la validación por FIRMWARE:
//
//   validado      → modelo + firmware probados end-to-end contra hardware.
//   experimental  → mismo CLI VRP que un modelo validado, pero nunca
//                   probado — puede operar, con riesgo de diferencias.
//   no_soportado  → sin driver o sin modelo declarado en el catálogo.
//
// Al detectar un error CLI en un equipo cuyo firmware no está validado,
// la clasificación correcta es "posible incompatibilidad de firmware",
// no "bug del driver" — este catálogo es la fuente de esa distinción.
// ─────────────────────────────────────────────────────────────

export type NivelCompatibilidad = 'validado' | 'firmware_no_probado' | 'experimental' | 'no_soportado';

export interface ModeloSoportado {
  modelo:             string;    // como lo reporta PRODUCT en 'display version'
  estado:             'validado' | 'experimental';
  // Firmwares (VERSION de 'display version') probados end-to-end.
  // Se compara solo la VERSION base — el PATCH (SPHxxx) no cambia el CLI.
  firmwaresValidados: string[];
  notas?:             string;
}

export const OLT_MODEL_CATALOG: Record<string, ModeloSoportado[]> = {
  huawei: [
    {
      modelo: 'MA5800-X7',
      estado: 'validado',
      // NODO MALVINAS (producción): VERSION MA5800V100R018C00 / PATCH SPH613.
      // Validado end-to-end: provisión, VLANs, traffic tables, uplink tagging,
      // baseline/convergencia, SNMP/NTP, TR-069 (2026-07).
      firmwaresValidados: ['MA5800V100R018C00'],
    },
    { modelo: 'MA5800-X2',  estado: 'experimental', firmwaresValidados: [], notas: 'Mismo CLI VRP que MA5800-X7; nunca probado contra hardware.' },
    { modelo: 'MA5800-X8',  estado: 'experimental', firmwaresValidados: [], notas: 'Mismo CLI VRP que MA5800-X7; nunca probado contra hardware.' },
    { modelo: 'MA5800-X15', estado: 'experimental', firmwaresValidados: [], notas: 'Mismo CLI VRP que MA5800-X7; nunca probado contra hardware.' },
    { modelo: 'MA5800-X17', estado: 'experimental', firmwaresValidados: [], notas: 'Mismo CLI VRP que MA5800-X7; nunca probado contra hardware.' },
    { modelo: 'MA5608T',    estado: 'experimental', firmwaresValidados: [], notas: 'VRP más antiguo (SmartAX clásico); diferencias de CLI probables.' },
  ],
  // Sin driver nativo validado todavía — el wizard no ofrece modelos.
  zte:   [],
  vsol:  [],
  cdata: [],
};

export interface EvaluacionCompatibilidad {
  nivel:   NivelCompatibilidad;
  mensaje: string;
}

// Compara ignorando el patch: 'MA5800V100R018C00/SPH613' → 'MA5800V100R018C00'.
function firmwareBase(firmware: string): string {
  return firmware.split('/')[0].trim().toUpperCase();
}

export function evaluarCompatibilidadModelo(
  marca:    string,
  modelo:   string | null,
  firmware: string | null,
): EvaluacionCompatibilidad {
  const modelos = OLT_MODEL_CATALOG[marca.toLowerCase()] ?? [];
  if (modelos.length === 0) {
    return {
      nivel:   'no_soportado',
      mensaje: `La marca "${marca}" no tiene modelos soportados por el driver nativo del ERP.`,
    };
  }
  if (!modelo) {
    return {
      nivel:   'no_soportado',
      mensaje: 'No se pudo detectar el modelo de la OLT (display version sin PRODUCT).',
    };
  }

  const entrada = modelos.find(m => m.modelo.toUpperCase() === modelo.trim().toUpperCase());
  if (!entrada) {
    return {
      nivel:   'no_soportado',
      mensaje: `El modelo "${modelo}" no está en el catálogo de compatibilidad del ERP.`,
    };
  }
  if (entrada.estado === 'experimental') {
    return {
      nivel:   'experimental',
      mensaje: `${entrada.modelo} es experimental: ${entrada.notas ?? 'nunca probado contra hardware real.'} ` +
               `Los errores CLI en este equipo deben clasificarse primero como posible incompatibilidad.`,
    };
  }
  if (!firmware) {
    return {
      nivel:   'firmware_no_probado',
      mensaje: `${entrada.modelo} es un modelo validado, pero no se pudo detectar su firmware.`,
    };
  }
  const base = firmwareBase(firmware);
  if (entrada.firmwaresValidados.some(f => f.toUpperCase() === base)) {
    return {
      nivel:   'validado',
      mensaje: `${entrada.modelo} con firmware ${base}: combinación validada end-to-end por el ERP.`,
    };
  }
  return {
    nivel:   'firmware_no_probado',
    mensaje: `${entrada.modelo} es un modelo validado, pero el firmware ${base} no está en la lista ` +
             `probada (${entrada.firmwaresValidados.join(', ')}). Los errores CLI en este equipo deben ` +
             `clasificarse primero como posible incompatibilidad de firmware.`,
  };
}
