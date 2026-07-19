// ─────────────────────────────────────────────────────────────
// Catálogo de ESTRATEGIAS de bootstrap TR-069 por CPE (ONT/ONU).
//
// Directriz de arquitectura (feedback_arquitectura_multicanal_provisioning, 2026-07-19):
// un canal representa una ESTRATEGIA de bootstrap, no una tecnología concreta. Así, el
// día que Huawei use DHCP Option 43, ZTE Option 125 y VSOL otro Vendor-Specific, todos
// siguen siendo la MISMA estrategia (`dhcp_bootstrap`) — no hay que renombrar nada.
//
//   omci_management_server → escribir el ACS en la ONU vía OMCI (ME137 / tr069-server-config)
//   dhcp_bootstrap         → la ONU descubre la ACS URL por DHCP (Option 43 / 125 / vendor)
//   cpe_local              → escribir vía el panel/API local del CPE (solo LAN del equipo)
//
// El resolver NUNCA confía en el "success" del canal: verifica convergencia real contra
// GenieACS (VIO: accepted ≠ materialized). Un modelo no catalogado => CPE_MODEL_NOT_SUPPORTED,
// jamás un intento a ciegas.
//
// Evidencia EG8145V5/V5R020C10S195 (CNT-2026-000004): `omci_management_server` NO materializa
// el ME137 en este firmware (validado con sniffer); `dhcp_bootstrap` (WAN mgmt DHCP + Option 43)
// SÍ converge (validado end-to-end). Por eso aquí dhcp_bootstrap es CERTIFIED y omci EXPERIMENTAL.
// En otro firmware donde el ME137 sí funcione, omci_management_server sería el CERTIFIED — la
// decisión es POR MODELO, nunca una dependencia global de un mecanismo.
//
// RIESGO CONFIRMADO: el panel web del EG8145V5 se autobloquea tras 3 logins fallidos
// (LoginTimes=3, LockLeftTime=42s) y solo escucha en la LAN del cliente (inalcanzable desde
// el backend). Por eso `cpe_local` es DISABLED — solo herramienta manual en sitio.
// ─────────────────────────────────────────────────────────────

export type NombreCanal = 'omci_management_server' | 'dhcp_bootstrap' | 'cpe_local';

// Nivel de confianza del canal para ESTE modelo/firmware — más expresivo que un booleano:
//   CERTIFIED    → probado end-to-end en hardware real, seguro para uso automático.
//   VALIDATED    → probado, pero aún no a escala/producción; el resolver lo usa en automático.
//   EXPERIMENTAL → implementado pero sin confirmar; solo se intenta si una política lo permite.
//   DISABLED     → no se intenta nunca en automático (inseguro, inalcanzable o descartado).
export type ConfidenceLevel = 'CERTIFIED' | 'VALIDATED' | 'EXPERIMENTAL' | 'DISABLED';

export interface CanalCapability {
  canal:      NombreCanal;
  confidence: ConfidenceLevel;
  notas:      string;
}

export interface CpeModelCapability {
  fabricante:          string;   // 'Huawei', 'ZTE', 'VSOL', ...
  modeloPattern:       RegExp;   // productClass / equipmentId reportado por OMCI/TR-069
  firmwaresValidados:  string[]; // vacío = aplica a cualquier firmware de ese modelo
  canales:             CanalCapability[];
}

// ─────────────────────────────────────────────────────────────
// Catálogo — una entrada por modelo/fabricante. Se amplía a medida que se
// certifican nuevos modelos/canales.
// ─────────────────────────────────────────────────────────────
export const CPE_PROVISIONING_CATALOG: CpeModelCapability[] = [
  {
    fabricante: 'Huawei',
    modeloPattern: /^EG8145V5$/i,
    firmwaresValidados: ['V5R020C10S195'],
    canales: [
      {
        canal: 'dhcp_bootstrap',
        confidence: 'CERTIFIED',
        notas: 'WAN de gestión en DHCP + ACS URL por DHCP Option 43 (servida por el MikroTik de la ' +
               'VLAN de gestión). Validado end-to-end 2026-07-19: lease real + Inform a GenieACS con la ' +
               'config ACS borrada (solo Option 43 pudo entregar la URL).',
      },
      {
        canal: 'omci_management_server',
        confidence: 'EXPERIMENTAL',
        notas: 'OMCI ME137 (ont tr069-server-config, WAN mgmt estática). Aceptado por el CLI de la OLT ' +
               'pero NO materializa la ACS URL en este firmware (CNT-2026-000004, confirmado con sniffer). ' +
               'Se mantiene catalogado por ser el estándar y para futuras variantes; su resultado SIEMPRE ' +
               'se verifica contra GenieACS — nunca se asume éxito.',
      },
      {
        canal: 'cpe_local',
        confidence: 'DISABLED',
        notas: 'Panel/API web del ONT. Funciona solo desde la LAN del cliente (verificado): el servidor web ' +
               'del ONT no escucha en la interfaz de gestión WAN, y la LAN del ONT no es ruteable desde el ' +
               'backend por diseño. Inalcanzable en automático — solo herramienta manual en sitio o base para ' +
               'un futuro agente local. Además el panel se autobloquea tras 3 logins fallidos.',
      },
    ],
  },
];

const RANGO: Record<ConfidenceLevel, number> = {
  CERTIFIED: 0, VALIDATED: 1, EXPERIMENTAL: 2, DISABLED: 99,
};

export interface EvaluacionCanales {
  soportado:   boolean;
  motivo?:     string;
  candidatos:  CanalCapability[]; // orden de intento: mayor confianza primero
}

// Devuelve los canales que el resolver debe intentar, ordenados por confianza.
// `permitirExperimental` (política) habilita los EXPERIMENTAL; por defecto solo
// entran CERTIFIED y VALIDATED. DISABLED nunca entra.
export function evaluarCanalesDisponibles(
  fabricante: string,
  modelo:     string,
  firmware:   string | null,
  permitirExperimental = false,
): EvaluacionCanales {
  const entrada = CPE_PROVISIONING_CATALOG.find(
    (e) => e.fabricante.toLowerCase() === fabricante.toLowerCase() && e.modeloPattern.test(modelo),
  );
  if (!entrada) {
    return { soportado: false, motivo: `Modelo no catalogado: ${fabricante} ${modelo}`, candidatos: [] };
  }

  const firmwareFueraDeLista =
    entrada.firmwaresValidados.length > 0 && firmware != null && !entrada.firmwaresValidados.includes(firmware);

  const nivelesAuto: ConfidenceLevel[] = firmwareFueraDeLista
    ? ['CERTIFIED']                                    // firmware desconocido → solo lo más seguro
    : permitirExperimental
      ? ['CERTIFIED', 'VALIDATED', 'EXPERIMENTAL']
      : ['CERTIFIED', 'VALIDATED'];

  const candidatos = entrada.canales
    .filter((c) => nivelesAuto.includes(c.confidence))
    .sort((a, b) => RANGO[a.confidence] - RANGO[b.confidence]);

  return {
    soportado: true,
    motivo: firmwareFueraDeLista
      ? `Firmware "${firmware}" no está en la lista validada (${entrada.firmwaresValidados.join(', ')}) — solo canales CERTIFIED.`
      : undefined,
    candidatos,
  };
}
