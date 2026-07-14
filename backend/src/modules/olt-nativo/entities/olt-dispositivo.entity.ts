import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { EstadoOlt } from '../../smartolt/entities/onu.entity';

// ─── Enums nuevos ─────────────────────────────────────────────
export enum OltMarca {
  HUAWEI = 'huawei',
  ZTE    = 'zte',
  VSOL   = 'vsol',
  CDATA  = 'cdata',
}

export enum OltMetodoConexion {
  SMARTOLT_API = 'smartolt_api',  // Proxy vía plataforma SmartOLT
  NATIVO_SSH   = 'nativo_ssh',   // Conexión SSH directa a la OLT (huawei_smartax via Netmiko)
  NATIVO_SNMP  = 'nativo_snmp',  // Monitoreo SNMP (solo lectura)
}

// ─── Re-export para consumidores de este módulo ───────────────
// EstadoOnu ya existe en smartolt con los 6 valores requeridos:
// sin_aprovisionar | aprovisionada | online | offline | error | reemplazada
export { EstadoOnu as OnuEstado } from '../../smartolt/entities/onu.entity';

// ─── OltDispositivo ───────────────────────────────────────────
// Tabla: olt_dispositivos
// Registra OLTs multimarca con acceso nativo (SSH/SNMP) o vía SmartOLT API.
// Cada OLT vive detrás de un Router MikroTik de cabecera (routerId).
@Entity('olt_dispositivos')
@Index('idx_olt_disp_empresa_activo', ['empresaId', 'activo'])
@Index('idx_olt_disp_empresa_marca',  ['empresaId', 'marca'])
@Index('idx_olt_disp_router',         ['routerId'])
@Index('idx_olt_disp_ip',             ['ipGestion'])
// Unicidad real de IP de gestión entre OLTs activas — creado por la migración
// 1791700000014; cierra la race condition del check-then-insert de _validarIpUnica.
@Index('uq_olt_disp_empresa_ip_activa', ['empresaId', 'ipGestion'], {
  unique: true,
  where:  '"activo" = true AND "deleted_at" IS NULL',
})
export class OltDispositivo extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Identificación ────────────────────────────────────────
  @Column({ length: 150 })
  nombre: string;   // Ej: "Cabecera Norte - OLT Principal"

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ type: 'enum', enum: OltMarca })
  marca: OltMarca;

  @Column({ length: 100, nullable: true })
  modelo: string;   // MA5800-X7, ZXA10 C300, VS-OLT1601GE, C-DATA FD1104S...

  // ── Conexión ──────────────────────────────────────────────
  @Column({
    name: 'metodo_conexion',
    type: 'enum',
    enum: OltMetodoConexion,
    default: OltMetodoConexion.NATIVO_SSH,
  })
  metodoConexion: OltMetodoConexion;

  @Column({ name: 'ip_gestion', type: 'inet' })
  ipGestion: string;   // IP privada dentro de la red VPN, ej: "10.0.50.2"

  @Column({ type: 'int', default: 22 })
  puerto: number;   // 22 para SSH | 161 para SNMP

  @Column({ name: 'usuario_anclado', length: 100 })
  usuarioAnclado: string;

  // Almacenado cifrado con AES-256-GCM (encryption.util.ts)
  // Formato en BD: iv:authTag:ciphertext (todo hexadecimal)
  @Column({ name: 'contrasena_cifrada', type: 'text' })
  contrasenaCifrada: string;

  // ── Capacidad física ──────────────────────────────────────
  @Column({ name: 'slots_totales', type: 'smallint', default: 1 })
  slotsTotales: number;   // Tarjetas físicas en el chasis

  @Column({ name: 'puertos_por_slot', type: 'smallint', default: 8 })
  puertosPorSlot: number;   // Puertos PON por tarjeta de línea

  @Column({
    name: 'vlan_gestion_defecto',
    type: 'smallint',
    nullable: true,
    comment: 'VLAN de gestión/tráfico por defecto. Ej: 201',
  })
  vlanGestionDefecto: number | null;

  // ── Perfil TR-069 por OLT (equivalente al "TR069 Profile" de SmartOLT) ──
  // Define la disponibilidad y parámetros del carril de gestión TR-069 para las ONUs
  // de esta OLT/segmento. La ACS URL viaja a la ONU por DHCP Option 43 (MikroTik);
  // usuario/clave = credenciales CWMP (ManagementServer.Username/Password) que la ONU
  // usa para autenticarse ante GenieACS (endurecimiento; opcional). Clave CIFRADA.
  @Column({ name: 'tr069_enabled', type: 'boolean', default: false })
  tr069Enabled: boolean;

  @Column({ name: 'tr069_acs_url', type: 'varchar', length: 255, nullable: true })
  tr069AcsUrl: string | null;

  @Column({ name: 'tr069_mgmt_vlan', type: 'smallint', nullable: true })
  tr069MgmtVlan: number | null;

  @Column({ name: 'tr069_acs_username', type: 'varchar', length: 100, nullable: true })
  tr069AcsUsername: string | null;

  /** Cifrada (AES). */
  @Column({ name: 'tr069_acs_password', type: 'text', nullable: true })
  tr069AcsPassword: string | null;

  // ── SNMP (complementa monitoreo pasivo) ───────────────────
  @Column({ name: 'snmp_community', length: 100, nullable: true, default: 'public' })
  snmpCommunity: string;

  @Column({ name: 'snmp_version', type: 'smallint', default: 2 })
  snmpVersion: number;   // 1 | 2 | 3

  // ── Config real SNMP/NTP leída de la OLT (Incremento 4b) ──
  // Distinto de snmpCommunity/snmpVersion arriba: aquellos son lo que el
  // ERP ASUME; estos son lo que la OLT REALMENTE reporta vía CLI.
  // Poblado por OltSyncService en cada sync, best-effort.
  @Column({ name: 'snmp_real_communities', type: 'jsonb', nullable: true })
  snmpRealCommunities: Array<{ name: string; access: 'read' | 'write' }> | null;

  @Column({ name: 'snmp_real_versions', type: 'jsonb', nullable: true })
  snmpRealVersions: string[] | null;

  @Column({ name: 'ntp_servers', type: 'jsonb', nullable: true })
  ntpServers: Array<{ source: string; stratum: number | null; reach: number; status: string }> | null;

  @Column({ name: 'config_snapshot_at', type: 'timestamptz', nullable: true })
  configSnapshotAt: Date | null;

  // ── Estado deseado NTP (Incremento 5 — convergencia real) ──
  // Simétrico a ntpServers arriba (real): esto es lo que el ERP QUIERE.
  @Column({ name: 'ntp_servers_deseados', type: 'jsonb', nullable: true })
  ntpServersDeseados: string[] | null;

  // ── Relaciones (FK almacenadas como UUID string) ──────────

  // Router MikroTik detrás del cual reside físicamente la OLT.
  // ON DELETE RESTRICT — no se puede borrar el router si tiene OLTs.
  @Column({ name: 'router_id', type: 'uuid', nullable: true })
  routerId: string | null;

  // Enlace opcional al módulo de telemetría pasiva.
  // ON DELETE SET NULL — si se borra el dispositivo de monitoreo, la OLT persiste.
  @Column({ name: 'dispositivo_monitoreo_id', type: 'uuid', nullable: true })
  dispositivoMonitoreoId: string | null;

  // ── Estado operativo ──────────────────────────────────────
  // Reutiliza el enum EstadoOlt existente (online|offline|mantenimiento|desconocido)
  @Column({ type: 'enum', enum: EstadoOlt, default: EstadoOlt.DESCONOCIDO })
  estado: EstadoOlt;

  @Column({ name: 'ultimo_ping', type: 'timestamptz', nullable: true })
  ultimoPing: Date;

  @Column({ name: 'total_pon_ports', type: 'smallint', nullable: true })
  totalPonPorts: number;   // slots_totales × puertos_por_slot (calculable, caché)

  @Column({ name: 'onus_activas', type: 'int', default: 0 })
  onusActivas: number;

  // ── Firmware detectado en test de conexión ────────────────
  @Column({ type: 'varchar', length: 100, nullable: true })
  firmware: string | null;

  // ── Zona ERP vinculada (para cross-ref de contratos) ─────
  @Column({ name: 'zona_id', type: 'uuid', nullable: true })
  zonaId: string | null;

  // ── Baseline declarativo asignado (Incremento 8) ─────────
  // Null = sin baseline; las reglas de compliance de baseline no aplican.
  @Column({ name: 'baseline_id', type: 'uuid', nullable: true })
  baselineId: string | null;

  // ── Ubicación geográfica ──────────────────────────────────
  @Column({ length: 200, nullable: true })
  ubicacion: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  @Column({ default: true })
  activo: boolean;
}
