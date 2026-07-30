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
// Evidencia EG8145V5/V5R020C10S195 — CORREGIDA el 2026-07-29:
//
// La conclusión previa (CNT-2026-000004) decía que `omci_management_server` NO materializaba el
// ME137 en este firmware. Era un FALSO NEGATIVO: al procedimiento le faltaban tres pasos del
// manual oficial de Huawei —`gpon ont home-gateway config-method omci`,
// `tr069-management ip-index 0` y sobre todo el binding `ont wan-config ip-index 0 profile-id X`—.
// Sin ese binding el IP-host nunca llega a ser una WAN, así que la config TR-069 no tiene dónde
// materializarse: el sniffer veía 0 tramas y se atribuyó al firmware.
//
// Con el procedimiento completo, AMBOS canales convergen. Se prefiere OMCI porque devuelve al ERP
// la propiedad del direccionamiento de gestión (IP estática del pool propio) en lugar de depender
// del pool de leases del MikroTik y de Option 43.
//
// LECCIÓN: una conclusión negativa sobre hardware vale lo que vale el procedimiento con que se
// obtuvo. "No funciona" puede significar "lo estábamos haciendo incompleto", y eso no se distingue
// sin comparar contra el manual del fabricante o contra un sistema que sí lo logre — aquí, SmartOLT
// gestionando 204 ONUs del mismo modelo en esta misma OLT con IP estática.
//
// La decisión es POR MODELO, nunca una dependencia global de un mecanismo.
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
        // PRIMERO desde 2026-07-29. La conclusión anterior ("el ME137 no materializa en este
        // firmware") era un FALSO NEGATIVO: al procedimiento le faltaban tres pasos del manual
        // oficial de Huawei, y el decisivo es el binding `ont wan-config ip-index 0 profile-id X`
        // — sin él el IP-host nunca llega a ser una WAN, así que la config TR-069 no tiene dónde
        // aplicarse. También faltaban `gpon ont home-gateway config-method omci` (que en esta OLT
        // ya estaba... puesto por SmartOLT, no por el ERP) y `tr069-management ip-index 0`.
        //
        // Verificado en hardware el 2026-07-29: la ONU pasó de informar por la IP del DHCP
        // (10.16.0.197) a informar por la IP ESTÁTICA del pool del ERP (10.16.0.10), y siguió
        // informando con normalidad. Evidencia coincidente: SmartOLT gestiona 204 ONUs del mismo
        // modelo y firmware en esta misma OLT con IP de gestión estática "via Mgmt IP".
        //
        // Se prefiere a DHCP porque devuelve al ERP la propiedad del direccionamiento: IPs
        // predecibles y estables, sin depender del pool de leases del MikroTik ni de Option 43.
        canal: 'omci_management_server',
        confidence: 'CERTIFIED',
        notas: 'OMCI ME137 (ont tr069-server-config) + IP de gestión ESTÁTICA del pool del ERP, con el ' +
               'procedimiento oficial completo: config-method omci, tr069-management ip-index 0, ' +
               'ont wan-config ip-index 0 y tr069-server-config. Validado en hardware 2026-07-29 ' +
               '(ONU informando por la IP estática del ERP). Su resultado SIEMPRE se verifica contra ' +
               'GenieACS — nunca se asume éxito.',
      },
      {
        // Sigue CERTIFIED y actúa como red de seguridad: si el OMCI no converge, el resolver
        // cae aquí solo. No se retira — es un canal probado y es el único que funciona si la
        // ONU no aplica el ME137 (otro firmware, otro modelo).
        canal: 'dhcp_bootstrap',
        confidence: 'CERTIFIED',
        notas: 'WAN de gestión en DHCP + ACS URL por DHCP Option 43 (servida por el MikroTik de la ' +
               'VLAN de gestión). Validado end-to-end 2026-07-19: lease real + Inform a GenieACS con la ' +
               'config ACS borrada (solo Option 43 pudo entregar la URL). Contrapartida: la IP la decide ' +
               'el MikroTik, así que el ERP pierde el control del direccionamiento de gestión.',
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
