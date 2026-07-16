import { BaselineSpec } from '../entities/olt-baseline.entity';

// ─────────────────────────────────────────────────────────────
// Baseline Datafast Estándar — la configuración CANÓNICA del ERP.
//
// Directriz (feedback_implementacion_desde_cero, 2026-07-15): el ERP
// inyecta SU configuración en cualquier OLT — nueva o en producción —
// y NUNCA se adapta a la preexistente (solo la respeta como intocable).
// Esta constante es la única fuente de verdad de esa configuración;
// cambiarla = nueva versión del baseline en cada empresa que lo genere.
//
// Valores definidos por el usuario (2026-07-15):
//   VLAN 1600 ERP-TR069     — gestión TR-069 (DHCP Option 43 → GenieACS)
//   VLAN 200  ERP-INTERNET  — servicio PPPoE/Internet
//   VLAN 220  ERP-IPTV      — RESERVADA: se agrega al spec cuando exista
//                             el módulo IPTV (no crear VLANs sin consumidor)
//   Service-ports 2000–3999 — rango exclusivo del ERP
//   ONU-IDs 1–128 por puerto — namespace físico; el pool ya asigna solo
//                             IDs libres verificando los ocupados en la OLT
// ─────────────────────────────────────────────────────────────

export const BASELINE_ESTANDAR_NOMBRE = 'Datafast Estándar';

export const VLAN_IPTV_RESERVADA = 220; // documentada, aún sin crear

// El uplinkPort depende del chasis (MA5800-X7: 0/9/0 — MPLB activa), por eso
// se recibe como parámetro al generar el baseline, no vive en la constante.
export function construirSpecEstandar(uplinkPort: string): BaselineSpec {
  return {
    vlans: [
      { vlanId: 1600, nombre: 'ERP-TR069',    proposito: 'tr069',    uplink: true },
      { vlanId: 200,  nombre: 'ERP-INTERNET', proposito: 'internet', uplink: true },
    ],
    trafficTables: [
      // Carril de gestión TR-069 (el bootstrap la usa en vez del index 0 de la OLT)
      { nombre: 'ERP-MGMT', cirKbps: 10_240,  pirKbps: 10_240  },
      { nombre: 'ERP-50M',  cirKbps: 51_200,  pirKbps: 51_200  },
      { nombre: 'ERP-100M', cirKbps: 102_400, pirKbps: 102_400 },
      { nombre: 'ERP-200M', cirKbps: 204_800, pirKbps: 204_800 },
      { nombre: 'ERP-400M', cirKbps: 409_600, pirKbps: 409_600 },
      { nombre: 'ERP-600M', cirKbps: 614_400, pirKbps: 614_400 },
      { nombre: 'ERP-800M', cirKbps: 819_200, pirKbps: 819_200 },
    ],
    servicePortRange: { inicio: 2000, fin: 3999 },
    uplinkPort,
  };
}

export const BASELINE_ESTANDAR_DESCRIPCION =
  'Configuración canónica del ERP (directriz: inyectar desde cero, nunca adaptarse). ' +
  'VLAN 1600 TR-069 + VLAN 200 Internet (ambas al uplink), carril ERP-MGMT y escalera ' +
  'de velocidades ERP-50M…ERP-800M, service-ports 2000–3999. VLAN 220 IPTV reservada.';
