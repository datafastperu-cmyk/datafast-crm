import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Enums ────────────────────────────────────────────────────
export enum EstadoOlt {
  ONLINE       = 'online',
  OFFLINE      = 'offline',
  MANTENIMIENTO = 'mantenimiento',
  DESCONOCIDO  = 'desconocido',
}

export enum EstadoOnu {
  SIN_APROVISIONAR = 'sin_aprovisionar',
  APROVISIONADA    = 'aprovisionada',
  ONLINE           = 'online',
  OFFLINE          = 'offline',
  ERROR            = 'error',
  REEMPLAZADA      = 'reemplazada',
}

// ─── OLT (Optical Line Terminal) ─────────────────────────────
@Entity('olts')
@Index(['empresaId', 'activo'])
export class Olt extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ length: 50, default: 'Huawei' })
  marca: string;

  @Column({ length: 100, nullable: true })
  modelo: string;   // MA5800-X7, MA5600T, MA5683T...

  // ── SmartOLT ─────────────────────────────────────────────
  @Column({ name: 'smartolt_id', length: 100, nullable: true })
  smartoltId: string;

  @Column({ name: 'ip_gestion', type: 'inet', nullable: true })
  ipGestion: string;

  @Column({ length: 100, nullable: true })
  usuario: string;

  @Column({ name: 'password_cifrado', length: 500, nullable: true })
  passwordCifrado: string;

  // ── Estado ───────────────────────────────────────────────
  @Column({ type: 'enum', enum: EstadoOlt, default: EstadoOlt.DESCONOCIDO })
  estado: EstadoOlt;

  @Column({ name: 'ultimo_ping', type: 'timestamptz', nullable: true })
  ultimoPing: Date;

  @Column({ name: 'total_pon_ports', type: 'smallint', nullable: true })
  totalPonPorts: number;

  @Column({ name: 'onus_activas', type: 'int', default: 0 })
  onusActivas: number;

  // ── Ubicación ────────────────────────────────────────────
  @Column({ length: 200, nullable: true })
  ubicacion: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  @Column({ default: true })
  activo: boolean;
}

// ─── ONU (Optical Network Unit) ──────────────────────────────
@Entity('onus')
@Index(['empresaId', 'estado'])
@Index(['oltId', 'ponPort', 'onuId'], { unique: true, where: 'deleted_at IS NULL' })
@Index(['serialNumber'])
export class Onu extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'olt_id' })
  oltId: string;

  // ── Identificación ────────────────────────────────────────
  @Column({ name: 'serial_number', length: 50 })
  serialNumber: string;

  @Column({ name: 'mac_address', type: 'macaddr', nullable: true })
  macAddress: string;

  @Column({ length: 100, nullable: true })
  modelo: string;

  @Column({ length: 50, default: 'Huawei' })
  marca: string;

  // ── PON ──────────────────────────────────────────────────
  @Column({ name: 'pon_port', length: 30, nullable: true })
  ponPort: string;       // '0/1/3' → slot/subslot/port

  @Column({ name: 'pon_slot', type: 'smallint', nullable: true })
  ponSlot: number;

  @Column({ name: 'pon_subslot', type: 'smallint', nullable: true })
  ponSubslot: number;

  @Column({ name: 'pon_port_num', type: 'smallint', nullable: true })
  ponPortNum: number;

  @Column({ name: 'onu_id', type: 'smallint', nullable: true })
  onuId: number;         // ID dentro del puerto PON (0-127)

  // ── Perfil SmartOLT ───────────────────────────────────────
  @Column({ name: 'perfil_smartolt', length: 100, nullable: true })
  perfilSmartolt: string;

  @Column({ name: 'smartolt_onu_id', length: 100, nullable: true })
  smartoltOnuId: string;

  // ── VLAN ─────────────────────────────────────────────────
  @Column({ name: 'vlan_id', type: 'smallint', nullable: true })
  vlanId: number;

  @Column({ name: 'vlan_modo', length: 20, default: 'access' })
  vlanModo: string;

  // ── Estado ───────────────────────────────────────────────
  @Column({ type: 'enum', enum: EstadoOnu, default: EstadoOnu.SIN_APROVISIONAR })
  estado: EstadoOnu;

  // ── Óptica ────────────────────────────────────────────────
  @Column({ name: 'rx_power_dbm', type: 'decimal', precision: 6, scale: 2, nullable: true })
  rxPowerDbm: number;

  @Column({ name: 'tx_power_dbm', type: 'decimal', precision: 6, scale: 2, nullable: true })
  txPowerDbm: number;

  @Column({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true })
  temperaturaC: number;

  @Column({ name: 'voltaje_v', type: 'decimal', precision: 6, scale: 3, nullable: true })
  voltajeV: number;

  @Column({ name: 'distancia_km', type: 'decimal', precision: 8, scale: 3, nullable: true })
  distanciaKm: number;

  // ── Aprovisionamiento ─────────────────────────────────────
  @Column({ name: 'aprovisionada_en', type: 'timestamptz', nullable: true })
  aprovisionadaEn: Date;

  @Column({ name: 'aprovisionada_por', nullable: true })
  aprovisionadaPor: string;

  @Column({ name: 'ultimo_online', type: 'timestamptz', nullable: true })
  ultimoOnline: Date;

  @Column({ type: 'text', nullable: true })
  descripcion: string;
}
