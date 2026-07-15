import { OLT_COMPLIANCE_RULES } from './olt-compliance-rules';
import { OltBaseline } from '../entities/olt-baseline.entity';
import { OltDispositivo, OltMarca, OltMetodoConexion } from '../entities/olt-dispositivo.entity';
import { InfrastructureSnapshot } from '../types/infrastructure-snapshot';
import { OltCapabilities } from '../capability/olt-capability-catalog';
import { EstadoOlt } from '../../smartolt/entities/onu.entity';

const baseOlt = (over: Partial<OltDispositivo> = {}): OltDispositivo => ({
  id: 'olt-1', empresaId: 'e1', nombre: 'OLT Test',
  marca: OltMarca.HUAWEI, modelo: 'MA5800-X7',
  metodoConexion: OltMetodoConexion.NATIVO_SSH,
  ipGestion: '10.0.0.1', puerto: 22, usuarioAnclado: 'erp-automation',
  contrasenaCifrada: 'x', slotsTotales: 1, puertosPorSlot: 8,
  vlanGestionDefecto: 201, tr069Enabled: false, tr069AcsUrl: null,
  tr069MgmtVlan: null, tr069AcsUsername: null, tr069AcsPassword: null,
  snmpCommunity: 'public', snmpVersion: 2, routerId: null,
  dispositivoMonitoreoId: null, estado: EstadoOlt.ONLINE, ultimoPing: null as any,
  totalPonPorts: null, onusActivas: 0, firmware: null, zonaId: null,
  ubicacion: null as any, latitud: null as any, longitud: null as any,
  activo: true, descripcion: null as any,
  ...over,
} as unknown as OltDispositivo);

const baseSnapshot = (over: Partial<InfrastructureSnapshot> = {}): InfrastructureSnapshot => ({
  oltId: 'olt-1', oltNombre: 'OLT Test', marca: 'huawei', modelo: null, firmware: null,
  boards: [{ slot: 0, boardType: 'GPBD', estado: 'normal', onuCount: 5, onuCapacity: 16, portsPorSlot: 16 }],
  vlans: [{ vlanId: 201, nombre: 'GESTION', origen: 'olt', estado: 'active' }],
  lineProfiles: [], serviceProfiles: [], trafficTables: [], opticalPorts: [],
  snmpCommunities: [{ name: 'public', access: 'read' }], snmpVersions: ['SNMPv2c'],
  ntpServers: [{ source: '1.1.1.1', stratum: 2, reach: 255, status: 'configured, synced' }],
  uplinkVlans: null,
  ultimoSyncEn: new Date(), ultimoSyncEstado: 'completed', ultimoHealthEn: null,
  configSnapshotEn: new Date(),
  ...over,
});

const capsHuawei: OltCapabilities = { tr069Dhcp43: true, snmp: true, fec: true, ipv6: false, vlanQinq: false };
const capsSinSoporte: OltCapabilities = { tr069Dhcp43: false, snmp: false, fec: false, ipv6: false, vlanQinq: false };

function run(
  olt: OltDispositivo, snapshot: InfrastructureSnapshot, caps: OltCapabilities,
  baseline: OltBaseline | null = null,
) {
  return Object.fromEntries(
    OLT_COMPLIANCE_RULES.map(r => [r(olt, snapshot, caps, baseline).regla, r(olt, snapshot, caps, baseline)]),
  );
}

const baseBaseline = (over: Partial<OltBaseline['spec']> = {}): OltBaseline => ({
  id: 'bl-1', empresaId: 'e1', nombre: 'Datafast', version: 1,
  descripcion: null, activo: true, createdAt: new Date(), updatedAt: new Date(),
  spec: {
    vlans:         [{ vlanId: 201, nombre: 'GESTION' }],
    trafficTables: [{ nombre: 'ERP-100M', cirKbps: 102400, pirKbps: 102400 }],
    ...over,
  },
} as OltBaseline);

describe('OLT_COMPLIANCE_RULES', () => {
  it('OLT sana: todas las reglas cumplen', () => {
    const checks = run(baseOlt(), baseSnapshot(), capsHuawei);
    expect(Object.values(checks).every(c => c.cumple)).toBe(true);
  });

  it('sin boards: boards_sincronizadas falla', () => {
    const checks = run(baseOlt(), baseSnapshot({ boards: [] }), capsHuawei);
    expect(checks.boards_sincronizadas.cumple).toBe(false);
  });

  it('VLAN de gestión ausente en la OLT: vlan_gestion_existe falla (critical)', () => {
    const checks = run(baseOlt({ vlanGestionDefecto: 999 }), baseSnapshot(), capsHuawei);
    expect(checks.vlan_gestion_existe.cumple).toBe(false);
    expect(checks.vlan_gestion_existe.severidad).toBe('critical');
  });

  it('sin VLAN de gestión configurada: la regla no aplica (pasa)', () => {
    const checks = run(baseOlt({ vlanGestionDefecto: null }), baseSnapshot(), capsHuawei);
    expect(checks.vlan_gestion_existe.cumple).toBe(true);
  });

  it('TR-069 habilitado sin VLAN mgmt: tr069_vlan_coherente falla', () => {
    const olt = baseOlt({ tr069Enabled: true, tr069MgmtVlan: null });
    const checks = run(olt, baseSnapshot(), capsHuawei);
    expect(checks.tr069_vlan_coherente.cumple).toBe(false);
  });

  it('TR-069 habilitado con VLAN mgmt ausente en snapshot: falla', () => {
    const olt = baseOlt({ tr069Enabled: true, tr069MgmtVlan: 300 });
    const checks = run(olt, baseSnapshot(), capsHuawei);
    expect(checks.tr069_vlan_coherente.cumple).toBe(false);
  });

  it('marca sin soporte TR-069: la regla no aplica aunque tr069Enabled sea true', () => {
    const olt = baseOlt({ tr069Enabled: true, tr069MgmtVlan: 300 });
    const checks = run(olt, baseSnapshot(), capsSinSoporte);
    expect(checks.tr069_vlan_coherente.cumple).toBe(true);
  });

  it('sync nunca corrido: snapshot_fresco falla', () => {
    const checks = run(baseOlt(), baseSnapshot({ ultimoSyncEn: null }), capsHuawei);
    expect(checks.snapshot_fresco.cumple).toBe(false);
  });

  it('sync hace 45 días: snapshot_fresco falla (umbral 30 días)', () => {
    const hace45 = new Date(Date.now() - 45 * 86_400_000);
    const checks = run(baseOlt(), baseSnapshot({ ultimoSyncEn: hace45 }), capsHuawei);
    expect(checks.snapshot_fresco.cumple).toBe(false);
  });

  it('community del ERP no existe en la OLT real: snmp_community_coherente falla', () => {
    const checks = run(baseOlt({ snmpCommunity: 'public' }), baseSnapshot({
      snmpCommunities: [{ name: 'otra-cosa', access: 'read' }],
    }), capsHuawei);
    expect(checks.snmp_community_coherente.cumple).toBe(false);
  });

  it('config SNMP aún no leída (snmpCommunities null): la regla no aplica', () => {
    const checks = run(baseOlt(), baseSnapshot({ snmpCommunities: null }), capsHuawei);
    expect(checks.snmp_community_coherente.cumple).toBe(true);
  });

  it('marca sin soporte SNMP: snmp_community_coherente no aplica', () => {
    const checks = run(baseOlt(), baseSnapshot({ snmpCommunities: [] }), capsSinSoporte);
    expect(checks.snmp_community_coherente.cumple).toBe(true);
  });

  it('sin community configurada en el ERP (OLT sin SNMP habilitado): la regla no aplica', () => {
    const checks = run(baseOlt({ snmpCommunity: null as any }), baseSnapshot(), capsHuawei);
    expect(checks.snmp_community_coherente.cumple).toBe(true);
  });

  it('NTP con reach=0 en todos los servidores: ntp_sincronizado falla', () => {
    const checks = run(baseOlt(), baseSnapshot({
      ntpServers: [{ source: '1.1.1.1', stratum: 16, reach: 0, status: 'configured, insane, invalid' }],
    }), capsHuawei);
    expect(checks.ntp_sincronizado.cumple).toBe(false);
  });

  it('NTP sin servidores configurados: ntp_sincronizado falla', () => {
    const checks = run(baseOlt(), baseSnapshot({ ntpServers: [] }), capsHuawei);
    expect(checks.ntp_sincronizado.cumple).toBe(false);
  });

  it('NTP aún no leído (null): la regla no aplica', () => {
    const checks = run(baseOlt(), baseSnapshot({ ntpServers: null }), capsHuawei);
    expect(checks.ntp_sincronizado.cumple).toBe(true);
  });

  it('tarjeta en falla: boards_saludables falla', () => {
    const snapshot = baseSnapshot({
      boards: [{ slot: 0, boardType: 'GPBD', estado: 'fault', onuCount: 0, onuCapacity: 16, portsPorSlot: 16 }],
    });
    const checks = run(baseOlt(), snapshot, capsHuawei);
    expect(checks.boards_saludables.cumple).toBe(false);
  });

  // ── Reglas de baseline (Incremento 8) ──────────────────────────
  it('sin baseline asignado: las reglas de baseline no aplican (pasan)', () => {
    const checks = run(baseOlt(), baseSnapshot(), capsHuawei, null);
    expect(checks.baseline_vlans_presentes.cumple).toBe(true);
    expect(checks.baseline_traffic_tables_presentes.cumple).toBe(true);
    expect(checks.baseline_vlans_presentes.severidad).toBe('info');
  });

  it('baseline cumplido: VLANs y traffic tables presentes con valores exactos', () => {
    const snapshot = baseSnapshot({
      trafficTables: [{ trafficId: 21, nombre: 'ERP-100M', cirKbps: 102400, pirKbps: 102400, tipo: 'combinado' }],
    });
    const checks = run(baseOlt(), snapshot, capsHuawei, baseBaseline());
    expect(checks.baseline_vlans_presentes.cumple).toBe(true);
    expect(checks.baseline_traffic_tables_presentes.cumple).toBe(true);
  });

  it('VLAN del baseline ausente: baseline_vlans_presentes falla (warning) y nombra la faltante', () => {
    const baseline = baseBaseline({ vlans: [{ vlanId: 201, nombre: 'GESTION' }, { vlanId: 300, nombre: 'INTERNET' }] });
    const checks = run(baseOlt(), baseSnapshot(), capsHuawei, baseline);
    expect(checks.baseline_vlans_presentes.cumple).toBe(false);
    expect(checks.baseline_vlans_presentes.severidad).toBe('warning');
    expect(checks.baseline_vlans_presentes.mensaje).toContain('300');
  });

  it('traffic table ausente: baseline_traffic_tables_presentes falla', () => {
    const checks = run(baseOlt(), baseSnapshot({ trafficTables: [] }), capsHuawei, baseBaseline());
    expect(checks.baseline_traffic_tables_presentes.cumple).toBe(false);
    expect(checks.baseline_traffic_tables_presentes.mensaje).toContain('ERP-100M');
  });

  it('uplink observado sin la VLAN declarada: baseline_uplink_taggeado falla', () => {
    const baseline = baseBaseline({
      vlans: [{ vlanId: 201, nombre: 'GESTION', uplink: true }],
      uplinkPort: '0/9/0',
    });
    const conObservado = baseSnapshot({ uplinkVlans: { '0/9/0': [1, 1500] } });
    const checks = run(baseOlt(), conObservado, capsHuawei, baseline);
    expect(checks.baseline_uplink_taggeado.cumple).toBe(false);
    expect(checks.baseline_uplink_taggeado.mensaje).toContain('201');

    // Y con la VLAN taggeada, cumple
    const ok = run(baseOlt(), baseSnapshot({ uplinkVlans: { '0/9/0': [1, 201] } }), capsHuawei, baseline);
    expect(ok.baseline_uplink_taggeado.cumple).toBe(true);

    // Sin observed state: no aplica (info)
    const sinObs = run(baseOlt(), baseSnapshot({ uplinkVlans: null }), capsHuawei, baseline);
    expect(sinObs.baseline_uplink_taggeado.cumple).toBe(true);
    expect(sinObs.baseline_uplink_taggeado.severidad).toBe('info');
  });

  it('traffic table con CIR/PIR distinto al declarado: falla y reporta el diff', () => {
    const snapshot = baseSnapshot({
      trafficTables: [{ trafficId: 21, nombre: 'ERP-100M', cirKbps: 51200, pirKbps: 51200, tipo: 'combinado' }],
    });
    const checks = run(baseOlt(), snapshot, capsHuawei, baseBaseline());
    expect(checks.baseline_traffic_tables_presentes.cumple).toBe(false);
    expect(checks.baseline_traffic_tables_presentes.mensaje).toContain('difiere');
  });
});
