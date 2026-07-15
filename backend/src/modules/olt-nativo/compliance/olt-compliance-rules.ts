import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltBaseline } from '../entities/olt-baseline.entity';
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
  baseline: OltBaseline | null,
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

// ── R6: la community SNMP que el ERP asume existe realmente en la OLT ──
const snmpComunityCoherente: ComplianceRule = (olt, snapshot, caps) => {
  if (!caps.snmp) {
    return {
      regla: 'snmp_community_coherente',
      cumple: true,
      severidad: 'info',
      mensaje: 'Marca sin soporte de lectura SNMP conocido — regla no aplica',
    };
  }
  if (!olt.snmpCommunity) {
    return {
      regla: 'snmp_community_coherente',
      cumple: true,
      severidad: 'info',
      mensaje: 'Sin community SNMP configurada en el ERP — regla no aplica (OLT no usa SNMP con este método de conexión)',
    };
  }
  if (snapshot.snmpCommunities === null) {
    return {
      regla: 'snmp_community_coherente',
      cumple: true,
      severidad: 'info',
      mensaje: 'Config SNMP real aún no leída de la OLT — regla no aplica hasta el próximo sync',
    };
  }
  const existe = snapshot.snmpCommunities.some(c => c.name === olt.snmpCommunity);
  return {
    regla: 'snmp_community_coherente',
    cumple: existe,
    severidad: 'warning',
    mensaje: existe
      ? `Community "${olt.snmpCommunity}" configurada en el ERP existe en la OLT`
      : `Community "${olt.snmpCommunity}" del ERP no coincide con ninguna community real de la OLT — el monitoreo SNMP probablemente falla`,
  };
};

// ── R7: al menos un servidor NTP configurado sincronizó alguna vez ──
const ntpSincronizado: ComplianceRule = (_olt, snapshot) => {
  if (snapshot.ntpServers === null) {
    return {
      regla: 'ntp_sincronizado',
      cumple: true,
      severidad: 'info',
      mensaje: 'Config NTP real aún no leída de la OLT — regla no aplica hasta el próximo sync',
    };
  }
  if (snapshot.ntpServers.length === 0) {
    return {
      regla: 'ntp_sincronizado',
      cumple: false,
      severidad: 'warning',
      mensaje: 'La OLT no tiene ningún servidor NTP configurado',
    };
  }
  // reach=0 (RFC 5905) = nunca recibió respuesta válida en los últimos 8 polls.
  const sincronizado = snapshot.ntpServers.some(s => s.reach > 0);
  return {
    regla: 'ntp_sincronizado',
    cumple: sincronizado,
    severidad: 'warning',
    mensaje: sincronizado
      ? 'Al menos un servidor NTP configurado está sincronizando'
      : `${snapshot.ntpServers.length} servidor(es) NTP configurado(s), pero ninguno respondió jamás (reach=0) — el reloj de la OLT probablemente está desviado`,
  };
};

// ── R8: las VLANs declaradas en el baseline existen en la OLT ────
// Incremento 8. Severidad warning: un baseline recién asignado aún no
// convergió (la escritura llega en el Incremento 9) — es trabajo pendiente,
// no una falla operativa.
const baselineVlansPresentes: ComplianceRule = (_olt, snapshot, _caps, baseline) => {
  if (!baseline) {
    return {
      regla: 'baseline_vlans_presentes',
      cumple: true,
      severidad: 'info',
      mensaje: 'Sin baseline asignado — regla no aplica',
    };
  }
  const enOlt = new Set(snapshot.vlans.map(v => v.vlanId));
  const faltantes = baseline.spec.vlans.filter(v => !enOlt.has(v.vlanId));
  const cumple = faltantes.length === 0;
  return {
    regla: 'baseline_vlans_presentes',
    cumple,
    severidad: 'warning',
    mensaje: cumple
      ? `Las ${baseline.spec.vlans.length} VLAN(s) del baseline "${baseline.nombre}" v${baseline.version} existen en la OLT`
      : `VLAN(s) del baseline ausentes en la OLT: ${faltantes.map(v => `${v.vlanId} (${v.nombre})`).join(', ')}`,
  };
};

// ── R9: las traffic tables del baseline existen con el CIR/PIR declarado ──
// Se comparan por nombre (el índice lo asigna la OLT y varía entre equipos).
const baselineTrafficTablesPresentes: ComplianceRule = (_olt, snapshot, _caps, baseline) => {
  if (!baseline) {
    return {
      regla: 'baseline_traffic_tables_presentes',
      cumple: true,
      severidad: 'info',
      mensaje: 'Sin baseline asignado — regla no aplica',
    };
  }
  const porNombre = new Map(snapshot.trafficTables.map(t => [t.nombre, t]));
  const problemas: string[] = [];
  for (const spec of baseline.spec.trafficTables) {
    const real = porNombre.get(spec.nombre);
    if (!real) {
      problemas.push(`"${spec.nombre}" no existe`);
    } else if (real.cirKbps !== spec.cirKbps || real.pirKbps !== spec.pirKbps) {
      problemas.push(
        `"${spec.nombre}" difiere: OLT CIR=${real.cirKbps}/PIR=${real.pirKbps} vs baseline CIR=${spec.cirKbps}/PIR=${spec.pirKbps}`,
      );
    }
  }
  const cumple = problemas.length === 0;
  return {
    regla: 'baseline_traffic_tables_presentes',
    cumple,
    severidad: 'warning',
    mensaje: cumple
      ? `Las ${baseline.spec.trafficTables.length} traffic table(s) del baseline "${baseline.nombre}" v${baseline.version} existen con los valores declarados`
      : `Traffic table(s) del baseline con problemas: ${problemas.join('; ')}`,
  };
};

// ── R10: las VLANs uplink del baseline están taggeadas en el puerto uplink ──
// Incremento 9b. Si el uplink nunca se observó (sync pendiente), no aplica —
// distinción Observed vs Current: la ausencia de lectura no es incumplimiento.
const baselineUplinkTaggeado: ComplianceRule = (_olt, snapshot, _caps, baseline) => {
  const uplinkPort  = baseline?.spec.uplinkPort;
  const vlansUplink = baseline?.spec.vlans.filter(v => v.uplink) ?? [];
  if (!baseline || !uplinkPort || vlansUplink.length === 0) {
    return {
      regla: 'baseline_uplink_taggeado',
      cumple: true,
      severidad: 'info',
      mensaje: !baseline
        ? 'Sin baseline asignado — regla no aplica'
        : 'El baseline no declara VLANs de uplink — regla no aplica',
    };
  }
  const observadas = snapshot.uplinkVlans?.[uplinkPort];
  if (observadas == null) {
    return {
      regla: 'baseline_uplink_taggeado',
      cumple: true,
      severidad: 'info',
      mensaje: `Estado del uplink ${uplinkPort} aún no observado — regla no aplica hasta el próximo sync`,
    };
  }
  const faltantes = vlansUplink.filter(v => !observadas.includes(v.vlanId));
  const cumple = faltantes.length === 0;
  return {
    regla: 'baseline_uplink_taggeado',
    cumple,
    severidad: 'warning',
    mensaje: cumple
      ? `Las ${vlansUplink.length} VLAN(s) de uplink del baseline están taggeadas en ${uplinkPort}`
      : `VLAN(s) sin taguear en el uplink ${uplinkPort}: ${faltantes.map(v => v.vlanId).join(', ')}`,
  };
};

export const OLT_COMPLIANCE_RULES: ComplianceRule[] = [
  boardsSincronizadas,
  vlanGestionExiste,
  tr069VlanCoherente,
  snapshotFresco,
  boardsSaludables,
  snmpComunityCoherente,
  ntpSincronizado,
  baselineVlansPresentes,
  baselineTrafficTablesPresentes,
  baselineUplinkTaggeado,
];
