import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Enums ────────────────────────────────────────────────────
export enum TipoNodo {
  ROUTER         = 'router',
  SWITCH         = 'switch',
  OLT            = 'olt',
  ANTENA         = 'antena',
  SERVIDOR       = 'servidor',
  CLIENTE        = 'cliente',
  ENLACE_UPLINK  = 'enlace_uplink',
}

export enum EstadoNodo {
  ONLINE       = 'online',
  OFFLINE      = 'offline',
  DEGRADADO    = 'degradado',
  MANTENIMIENTO = 'mantenimiento',
  DESCONOCIDO  = 'desconocido',
}

export enum NivelAlerta {
  INFO     = 'info',
  WARNING  = 'warning',
  CRITICAL = 'critical',
  RECOVERY = 'recovery',
}

export enum EstadoAlerta {
  ACTIVA    = 'activa',
  RESUELTA  = 'resuelta',
  IGNORADA  = 'ignorada',
}

export enum MetricaAlerta {
  PING_LATENCIA   = 'ping_latencia',
  PING_PERDIDA    = 'ping_perdida',
  CPU             = 'cpu',
  MEMORIA         = 'memoria',
  TRAFICO_BAJADA  = 'trafico_bajada',
  TRAFICO_SUBIDA  = 'trafico_subida',
  TEMPERATURA     = 'temperatura',
  ESTADO_NODO     = 'estado_nodo',
  SESIONES_PPPOE  = 'sesiones_pppoe',
  SENAL_ONU       = 'senal_onu',
}

// ─── Nodo a monitorear ────────────────────────────────────────
@Entity('nodos')
@Index(['empresaId', 'activo'])
@Index(['empresaId', 'estado'])
@Index(['ipMonitoreo'])
export class Nodo extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ type: 'enum', enum: TipoNodo, default: TipoNodo.ROUTER })
  tipo: TipoNodo;

  // ── Referencia al equipo ──────────────────────────────────
  @Column({ name: 'router_id', nullable: true })
  routerId: string;

  @Column({ name: 'olt_id', nullable: true })
  oltId: string;

  // ── Conexión ──────────────────────────────────────────────
  @Column({ name: 'ip_monitoreo', type: 'inet' })
  ipMonitoreo: string;

  // ── SNMP ──────────────────────────────────────────────────
  @Column({ name: 'snmp_habilitado', default: false })
  snmpHabilitado: boolean;

  @Column({ name: 'snmp_community', length: 100, default: 'public' })
  snmpCommunity: string;

  @Column({ name: 'snmp_version', type: 'smallint', default: 2 })
  snmpVersion: number;

  @Column({ name: 'snmp_puerto', type: 'smallint', default: 161 })
  snmpPuerto: number;

  @Column({ name: 'snmp_oid_trafico_rx', length: 200, nullable: true })
  snmpOidTraficoRx: string;  // OID para bytes recibidos (ifInOctets)

  @Column({ name: 'snmp_oid_trafico_tx', length: 200, nullable: true })
  snmpOidTraficoTx: string;

  @Column({ name: 'snmp_oid_cpu', length: 200, nullable: true })
  snmpOidCpu: string;

  @Column({ name: 'snmp_interface_index', type: 'int', nullable: true })
  snmpInterfaceIndex: number; // ifIndex de la interfaz WAN

  // ── Ping ──────────────────────────────────────────────────
  @Column({ name: 'ping_habilitado', default: true })
  pingHabilitado: boolean;

  @Column({ name: 'ping_intervalo_seg', type: 'smallint', default: 60 })
  pingIntervaloSeg: number;

  @Column({ name: 'ping_timeout_ms', type: 'int', default: 3000 })
  pingTimeoutMs: number;

  @Column({ name: 'ping_reintentos', type: 'smallint', default: 3 })
  pingReintentos: number;

  // ── Estado actual ─────────────────────────────────────────
  @Column({ type: 'enum', enum: EstadoNodo, default: EstadoNodo.DESCONOCIDO })
  estado: EstadoNodo;

  @Column({ name: 'ultimo_ping', type: 'timestamptz', nullable: true })
  ultimoPing: Date;

  @Column({ name: 'latencia_ms', type: 'decimal', precision: 8, scale: 2, nullable: true })
  latenciaMs: number;

  @Column({ name: 'perdida_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  perdidaPct: number;

  @Column({ name: 'estado_desde', type: 'timestamptz', default: () => 'NOW()' })
  estadoDesde: Date;

  @Column({ name: 'uptime_pct_7d', type: 'decimal', precision: 5, scale: 2, nullable: true })
  uptimePct7d: number;

  // ── Métricas actuales ─────────────────────────────────────
  @Column({ name: 'cpu_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  cpuUsoPct: number;

  @Column({ name: 'memoria_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  memoriaUsoPct: number;

  @Column({ name: 'trafico_rx_bps', type: 'bigint', nullable: true })
  traficoRxBps: number;

  @Column({ name: 'trafico_tx_bps', type: 'bigint', nullable: true })
  traficoTxBps: number;

  @Column({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true })
  temperaturaC: number;

  @Column({ name: 'sesiones_pppoe', type: 'int', nullable: true })
  sesionesPppoe: number;

  // ── Configuración ─────────────────────────────────────────
  @Column({ default: true })
  activo: boolean;

  @Column({ name: 'alertas_habilitadas', default: true })
  alertasHabilitadas: boolean;

  // ── GPS ───────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;
}

// ─── Medición histórica del nodo ──────────────────────────────
@Entity('nodos_mediciones')
@Index(['nodoId', 'timestamp'])
@Index(['empresaId', 'timestamp'])
export class MedicionNodo {

  @Column({ primary: true, generated: 'uuid' })
  id: string;

  @Column({ name: 'nodo_id' })
  nodoId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'timestamp', type: 'timestamptz', default: () => 'NOW()' })
  timestamp: Date;

  // Ping
  @Column({ name: 'latencia_ms', type: 'decimal', precision: 8, scale: 2, nullable: true })
  latenciaMs: number;

  @Column({ name: 'perdida_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  perdidaPct: number;

  @Column({ name: 'online', default: true })
  online: boolean;

  // SNMP
  @Column({ name: 'cpu_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  cpuPct: number;

  @Column({ name: 'memoria_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  memoriaPct: number;

  @Column({ name: 'trafico_rx_bps', type: 'bigint', nullable: true })
  traficoRxBps: number;

  @Column({ name: 'trafico_tx_bps', type: 'bigint', nullable: true })
  traficoTxBps: number;

  @Column({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true })
  temperaturaC: number;

  @Column({ name: 'sesiones_pppoe', type: 'int', nullable: true })
  sesionesPppoe: number;
}

// ─── Alerta generada ──────────────────────────────────────────
@Entity('alertas')
@Index(['empresaId', 'estado', 'nivel'])
@Index(['nodoId', 'createdAt'])
@Index(['empresaId', 'createdAt'])
export class Alerta extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'nodo_id', nullable: true })
  nodoId: string;

  @Column({ name: 'nodo_nombre', length: 100, nullable: true })
  nodoNombre: string;

  @Column({ type: 'enum', enum: NivelAlerta })
  nivel: NivelAlerta;

  @Column({ type: 'enum', enum: EstadoAlerta, default: EstadoAlerta.ACTIVA })
  estado: EstadoAlerta;

  @Column({ type: 'enum', enum: MetricaAlerta })
  metrica: MetricaAlerta;

  @Column({ type: 'text' })
  mensaje: string;

  @Column({ type: 'text', nullable: true })
  detalle: string;

  // Valor que disparó la alerta
  @Column({ name: 'valor_actual', type: 'decimal', precision: 12, scale: 4, nullable: true })
  valorActual: number;

  @Column({ name: 'umbral', type: 'decimal', precision: 12, scale: 4, nullable: true })
  umbral: number;

  // Resolución
  @Column({ name: 'resuelta_en', type: 'timestamptz', nullable: true })
  resueltaEn: Date;

  @Column({ name: 'resuelta_por', nullable: true })
  resueltaPor: string;

  @Column({ name: 'duracion_minutos', type: 'int', nullable: true })
  duracionMinutos: number;

  // Notificaciones
  @Column({ name: 'notificado_email', default: false })
  notificadoEmail: boolean;

  @Column({ name: 'notificado_whatsapp', default: false })
  notificadoWhatsapp: boolean;
}

// ─── Configuración de umbrales de alerta ─────────────────────
@Entity('configuracion_alertas')
@Index(['empresaId', 'activo'])
export class ConfiguracionAlerta extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'nodo_id', nullable: true })
  nodoId: string;  // null = aplica a todos los nodos de la empresa

  @Column({ type: 'enum', enum: MetricaAlerta })
  metrica: MetricaAlerta;

  @Column({ name: 'umbral_warning', type: 'decimal', precision: 10, scale: 2 })
  umbralWarning: number;

  @Column({ name: 'umbral_critical', type: 'decimal', precision: 10, scale: 2 })
  umbralCritical: number;

  // Tiempo que debe superar el umbral antes de alertar
  @Column({ name: 'duracion_minutos', type: 'smallint', default: 1 })
  duracionMinutos: number;

  @Column({ name: 'notificar_email', default: false })
  notificarEmail: boolean;

  @Column({ name: 'notificar_whatsapp', default: false })
  notificarWhatsapp: boolean;

  @Column({ name: 'email_destino', length: 200, nullable: true })
  emailDestino: string;

  @Column({ name: 'telefono_destino', length: 20, nullable: true })
  telefonoDestino: string;

  @Column({ default: true })
  activo: boolean;

  @Column({ type: 'text', nullable: true })
  descripcion: string;
}
