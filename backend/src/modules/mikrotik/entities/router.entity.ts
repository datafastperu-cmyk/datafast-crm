import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum VersionRouterOS {
  V6          = 'v6',
  V7          = 'v7',
  DESCONOCIDA = 'desconocida',
}

export enum MetodoConexion {
  API         = 'api',
  API_SSL     = 'api_ssl',
  SSH         = 'ssh',
  SNMP        = 'snmp',
  VPN_TUNNEL  = 'vpn_tunnel',
}

export enum EstadoEquipo {
  ONLINE        = 'online',
  OFFLINE       = 'offline',
  DEGRADADO     = 'degradado',
  MANTENIMIENTO = 'mantenimiento',
  DESCONOCIDO   = 'desconocido',
}

export enum TipoControl {
  NINGUNA            = 'ninguna',
  AMARRE_IP_MAC      = 'amarre_ip_mac',
  AMARRE_IP_MAC_DHCP = 'amarre_ip_mac_dhcp',
}

export enum TipoControlVelocidad {
  NINGUNO           = 'ninguno',
  COLAS_SIMPLES     = 'colas_simples',
  PCQ_ADDRESSLIST   = 'pcq_addresslist',
  DHCP_LEASE_QUEUES = 'dhcp_lease_queues',
}

@Entity('routers')
@Index(['empresaId', 'activo'])
@Index(['empresaId', 'estado'])
@Index(['ipGestion'])
export class Router extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Identificación ────────────────────────────────────────
  @Column({ length: 100 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ length: 200, nullable: true })
  ubicacion: string;

  @Column({ length: 100, nullable: true })
  modelo: string;  // CCR1036, hAP ac3, RB4011...

  // ── Conexión ──────────────────────────────────────────────
  @Column({ name: 'ip_gestion', type: 'inet' })
  ipGestion: string;

  @Column({ name: 'puerto_api', type: 'smallint', default: 8728 })
  puertoApi: number;

  @Column({ name: 'puerto_api_ssl', type: 'smallint', default: 8729 })
  puertoApiSsl: number;

  @Column({ name: 'puerto_ssh', type: 'smallint', default: 22 })
  puertoSsh: number;

  @Column({ length: 100 })
  usuario: string;

  @Column({ name: 'password_cifrado', length: 500 })
  passwordCifrado: string;   // AES-256-GCM

  @Column({
    name: 'version_ros',
    type: 'enum',
    enum: VersionRouterOS,
    default: VersionRouterOS.DESCONOCIDA,
  })
  versionRos: VersionRouterOS;

  @Column({
    name: 'metodo_conexion',
    type: 'enum',
    enum: MetodoConexion,
    default: MetodoConexion.API,
  })
  metodoConexion: MetodoConexion;

  @Column({ name: 'usar_ssl', default: false })
  usarSsl: boolean;

  @Column({ name: 'timeout_conexion', type: 'smallint', default: 10 })
  timeoutConexion: number;  // segundos

  // ── Estado y monitoreo ────────────────────────────────────
  @Column({
    type: 'enum',
    enum: EstadoEquipo,
    default: EstadoEquipo.DESCONOCIDO,
  })
  estado: EstadoEquipo;

  @Column({ name: 'ultimo_ping', type: 'timestamptz', nullable: true })
  ultimoPing: Date;

  @Column({ name: 'latencia_ms', type: 'decimal', precision: 8, scale: 2, nullable: true })
  latenciaMs: number;

  @Column({ name: 'uptime_segundos', type: 'bigint', nullable: true })
  uptimeSegundos: number;

  @Column({ name: 'version_firmware', length: 50, nullable: true })
  versionFirmware: string;

  @Column({ name: 'identity_routeros', length: 100, nullable: true })
  identityRouteros: string;  // hostname del router

  // ── Recursos ──────────────────────────────────────────────
  @Column({ name: 'cpu_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  cpuUsoPct: number;

  @Column({ name: 'memoria_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  memoriaUsoPct: number;

  @Column({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true })
  temperaturaC: number;

  // ── GPS ───────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  // ── Configuración automática ─────────────────────────────
  @Column({ name: 'auto_configurar_queues',   default: true })
  autoConfigurarQueues: boolean;

  @Column({ name: 'auto_configurar_pppoe',    default: true })
  autoConfigurarPppoe: boolean;

  @Column({ name: 'auto_configurar_firewall', default: true })
  autoConfigurarFirewall: boolean;

  // ── SNMP ──────────────────────────────────────────────────
  @Column({ name: 'snmp_community', length: 100, default: 'public' })
  snmpCommunity: string;

  @Column({ name: 'snmp_version', type: 'smallint', default: 2 })
  snmpVersion: number;

  // ── VPN ───────────────────────────────────────────────────
  @Column({ name: 'vpn_ip', length: 50, nullable: true })
  vpnIp: string;

  // ── Zona / Sector ─────────────────────────────────────────
  @Column({ length: 100, nullable: true })
  zona: string;

  // ── Reintentos de reconexión ──────────────────────────────
  @Column({ type: 'smallint', default: 3 })
  reintentos: number;

  // ── Control de seguridad ──────────────────────────────────
  @Column({
    name: 'tipo_control',
    type: 'enum',
    enum: TipoControl,
    default: TipoControl.NINGUNA,
  })
  tipoControl: TipoControl;

  // ── Control de velocidad ───────────────────────────────────
  @Column({
    name: 'tipo_control_velocidad',
    type: 'enum',
    enum: TipoControlVelocidad,
    default: TipoControlVelocidad.NINGUNO,
  })
  tipoControlVelocidad: TipoControlVelocidad;

  @Column({ default: true })
  activo: boolean;
}
