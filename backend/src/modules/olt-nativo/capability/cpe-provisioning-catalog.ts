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
// Evidencia EG8145V5/V5R020C10S195 (CNT-2026-000004, re-verificada el 2026-07-29):
// `omci_management_server` NO materializa la ACS URL en este firmware; `dhcp_bootstrap`
// (WAN mgmt DHCP + Option 43) SÍ converge. Por eso dhcp_bootstrap es CERTIFIED y omci
// EXPERIMENTAL. En otro firmware donde el ME137 sí funcione, omci sería el CERTIFIED — la
// decisión es POR MODELO, nunca una dependencia global de un mecanismo.
//
// El 2026-07-29 se completó el procedimiento oficial de Huawei que faltaba y se intentó
// promover omci a CERTIFIED. Se revirtió: ver la nota del canal para el detalle, y sobre todo
// para la LECCIÓN METODOLÓGICA — una prueba de bootstrap sobre un equipo que YA tiene la
// configuración que se quiere ver aparecer no prueba nada, y su falso positivo es más caro
// que un falso negativo.
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
               'VLAN de gestión). Validado end-to-end 2026-07-19 y RE-CONFIRMADO 2026-07-29 con ONU ' +
               'restablecida de fábrica: es el único canal que hace converger este modelo. ' +
               'Contrapartida conocida: la IP la decide el MikroTik, así que el ERP no controla el ' +
               'direccionamiento de gestión.',
      },
      {
        // 2026-07-29 — se intentó promoverlo a CERTIFIED y se REVIRTIÓ. Vale documentar por qué,
        // porque la trampa es sutil y volverá a tentar a quien lea esto:
        //
        // Se completó el procedimiento oficial de Huawei que faltaba (`config-method omci`,
        // `tr069-management ip-index 0` y el binding `ont wan-config ip-index 0 profile-id X`) y
        // se probó sobre una ONU YA PROVISIONADA Y EN SERVICIO: el ipconfig pasó a "Static config"
        // y la ONU siguió informando al ACS por la IP estática del ERP. Parecía la confirmación.
        //
        // NO LO ERA. Esa ONU ya tenía la ACS URL escrita de antes (recibida por Option 43), así
        // que siguió informando con la URL que ya tenía: la prueba no aislaba la variable que
        // pretendía medir. Repetida con una ONU RESTABLECIDA DE FÁBRICA —sin URL previa— el
        // resultado fue: `ONT config type: DHCP`, IP del MikroTik, y la URL llegó otra vez por
        // Option 43. El ME137 sigue sin materializar la ACS URL en este firmware.
        //
        // LECCIÓN: para probar un mecanismo de bootstrap hay que partir de un equipo SIN la
        // configuración que se quiere ver aparecer. Si el estado previo puede explicar el
        // resultado, la prueba no prueba nada — y el falso positivo es más caro que el negativo,
        // porque promueve a CERTIFIED un canal que no converge.
        //
        // Lo que SÍ se conserva del intento: los tres comandos del procedimiento oficial (son
        // correctos y crean la WAN TR-069 de verdad) y el wan-profile PROPIO del ERP
        // (DATAFAST-MGMT), que antes se colgaba del "profile-id 0 smartolt".
        canal: 'omci_management_server',
        confidence: 'EXPERIMENTAL',
        notas: 'OMCI ME137 (ont tr069-server-config) + IP de gestión estática. Con el procedimiento ' +
               'oficial COMPLETO crea la WAN TR-069 y el IP-host estático funciona en una ONU ya ' +
               'operativa, pero NO escribe la ACS URL: verificado 2026-07-29 con ONU de fábrica, que ' +
               'quedó en DHCP y tomó la URL por Option 43. Se mantiene catalogado por ser el estándar ' +
               'y para otros firmwares. Su resultado SIEMPRE se verifica contra GenieACS.',
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
