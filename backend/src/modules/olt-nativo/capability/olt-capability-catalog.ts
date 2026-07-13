import { OltMarca } from '../entities/olt-dispositivo.entity';

// ═══════════════════════════════════════════════════════════════════════════
// Catálogo de capacidades por marca de OLT — Incremento 3
//
// Responde "¿esta OLT soporta X?" sin que el resto del sistema (p.ej. las
// reglas de cumplimiento del Incremento 4) necesite preguntar "¿es Huawei?".
// Mismo espíritu que ztp/device-profiles — un catálogo por marca en vez de
// ifs esparcidos por el código.
//
// Solo Huawei tiene integración nativa real hoy (nativo_ssh). ZTE, V-SOL y
// C-Data existen como enum pero no como driver — sus capacidades quedan en
// false/desconocidas a propósito: no se modela lo que aún no se construye.
// ═══════════════════════════════════════════════════════════════════════════

export interface OltCapabilities {
  /** Bootstrap TR-069 zero-touch vía DHCP Option 43 (ver project_tr069_derisk). */
  tr069Dhcp43: boolean;
  /** SNMP de monitoreo (community/version ya en OltDispositivo). */
  snmp:        boolean;
  /** Forward Error Correction en puertos GPON. */
  fec:         boolean;
  /** IPv6 en el plano de gestión/servicios. */
  ipv6:        boolean;
  /** VLAN QinQ (doble etiquetado). */
  vlanQinq:    boolean;
}

const SIN_SOPORTE: OltCapabilities = {
  tr069Dhcp43: false,
  snmp:        false,
  fec:         false,
  ipv6:        false,
  vlanQinq:    false,
};

const CATALOGO: Record<OltMarca, OltCapabilities> = {
  [OltMarca.HUAWEI]: {
    tr069Dhcp43: true,
    snmp:        true,
    fec:         true,
    ipv6:        false,
    vlanQinq:    false,
  },
  // Sin driver nativo todavía — capacidades desconocidas, nunca asumidas.
  [OltMarca.ZTE]:   SIN_SOPORTE,
  [OltMarca.VSOL]:  SIN_SOPORTE,
  [OltMarca.CDATA]: SIN_SOPORTE,
};

export function resolverCapacidadesOlt(marca: OltMarca): OltCapabilities {
  return CATALOGO[marca] ?? SIN_SOPORTE;
}
