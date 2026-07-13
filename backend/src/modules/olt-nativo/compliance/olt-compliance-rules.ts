import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { InfrastructureSnapshot } from '../types/infrastructure-snapshot';
import { OltCapabilities } from '../capability/olt-capability-catalog';

// ═══════════════════════════════════════════════════════════════════════════
// Reglas de cumplimiento — Incremento 4
//
// No es un "Policy Engine": son 5 funciones puras que leen el
// InfrastructureSnapshot ya persistido (Incremento 2) más la config
// declarada en OltDispositivo. Ninguna abre SSH — corren en milisegundos.
//
// Se agrega un Policy Engine formal cuando el catálogo de reglas
// crezca lo suficiente para justificarlo (ver
// project_infra_architecture_incremental). Con 5 reglas no hace falta.
// ═══════════════════════════════════════════════════════════════════════════

export type ComplianceSeveridad = 'info' | 'warning' | 'critical';

export interface ComplianceCheck {
  regla:     string;
  cumple:    boolean;
  severidad: ComplianceSeveridad;
  mensaje:   string;
}

export type ComplianceRule = (
  olt:      OltDispositivo,
  snapshot: InfrastructureSnapshot,
  caps:     OltCapabilities,
) => ComplianceCheck;

const DIAS_SNAPSHOT_OBSOLETO = 30;

// ── R1: la OLT tiene al menos una tarjeta sincronizada ──────────
const boardsSincronizadas: ComplianceRule = (olt, snapshot) => {
  const cumple = snapshot.boards.length > 0;
  return {
    regla: 'boards_sincronizadas',
    cumple,
    severidad: 'warning',
    mensaje: cumple
      ? `${snapshot.boards.length} tarjeta(s) sincronizada(s)`
      : 'La OLT no tiene tarjetas en el read-model — nunca se sincronizó o el último sync falló',
  };
};

// ── R2: la VLAN de gestión por defecto existe entre las VLANs sincronizadas ──
const vlanGestionExiste: ComplianceRule = (olt, snapshot) => {
  if (olt.vlanGestionDefecto === null) {
    return {
      regla: 'vlan_gestion_existe',
      cumple: true,
      severidad: 'info',
      mensaje: 'Sin VLAN de gestión configurada — regla no aplica',
    };
  }
  const existe = snapshot.vlans.some(v => v.vlanId === olt.vlanGestionDefecto);
  return {
    regla: 'vlan_gestion_existe',
    cumple: existe,
    severidad: 'critical',
    mensaje: existe
      ? `VLAN de gestión ${olt.vlanGestionDefecto} presente en la OLT`
      : `VLAN de gestión ${olt.vlanGestionDefecto} configurada en el ERP pero no existe en la OLT`,
  };
};

// ── R3: si TR-069 está habilitado, la VLAN de gestión TR-069 existe ──
const tr069VlanCoherente: ComplianceRule = (olt, snapshot, caps) => {
  if (!olt.tr069Enabled || !caps.tr069Dhcp43) {
    return {
      regla: 'tr069_vlan_coherente',
      cumple: true,
      severidad: 'info',
      mensaje: !olt.tr069Enabled
        ? 'TR-069 no habilitado en esta OLT — regla no aplica'
        : 'Marca sin soporte TR-069 DHCP43 conocido — regla no aplica',
    };
  }
  if (olt.tr069MgmtVlan === null) {
    return {
      regla: 'tr069_vlan_coherente',
      cumple: false,
      severidad: 'critical',
      mensaje: 'TR-069 habilitado pero sin VLAN de gestión TR-069 configurada',
    };
  }
  const existe = snapshot.vlans.some(v => v.vlanId === olt.tr069MgmtVlan);
  return {
    regla: 'tr069_vlan_coherente',
    cumple: existe,
    severidad: 'critical',
    mensaje: existe
      ? `VLAN TR-069 ${olt.tr069MgmtVlan} presente en la OLT`
      : `VLAN TR-069 ${olt.tr069MgmtVlan} configurada en el ERP pero no existe en la OLT`,
  };
};

// ── R4: el snapshot no está obsoleto ─────────────────────────────
const snapshotFresco: ComplianceRule = (olt, snapshot) => {
  if (!snapshot.ultimoSyncEn) {
    return {
      regla: 'snapshot_fresco',
      cumple: false,
      severidad: 'warning',
      mensaje: 'La OLT nunca completó una sincronización',
    };
  }
  const diasDesdeSync = (Date.now() - snapshot.ultimoSyncEn.getTime()) / 86_400_000;
  const cumple = diasDesdeSync <= DIAS_SNAPSHOT_OBSOLETO;
  return {
    regla: 'snapshot_fresco',
    cumple,
    severidad: 'warning',
    mensaje: cumple
      ? `Último sync hace ${Math.round(diasDesdeSync)} día(s)`
      : `Último sync hace ${Math.round(diasDesdeSync)} día(s) — supera el umbral de ${DIAS_SNAPSHOT_OBSOLETO}`,
  };
};

// ── R5: ninguna tarjeta reporta estado de falla ─────────────────
const ESTADOS_FALLA = ['fault', 'absent'];
const boardsSaludables: ComplianceRule = (olt, snapshot) => {
  const conFalla = snapshot.boards.filter(b => ESTADOS_FALLA.includes(b.estado.toLowerCase()));
  const cumple = conFalla.length === 0;
  return {
    regla: 'boards_saludables',
    cumple,
    severidad: 'critical',
    mensaje: cumple
      ? 'Todas las tarjetas reportan estado normal'
      : `Tarjeta(s) en falla: slot ${conFalla.map(b => b.slot).join(', ')}`,
  };
};

export const OLT_COMPLIANCE_RULES: ComplianceRule[] = [
  boardsSincronizadas,
  vlanGestionExiste,
  tr069VlanCoherente,
  snapshotFresco,
  boardsSaludables,
];
