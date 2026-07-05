import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum FtthOnuEstado {
  PENDIENTE              = 'pendiente',
  GPON_REGISTRADO        = 'gpon_registrado',
  WAN_INYECTADO          = 'wan_inyectado',
  ACTIVO                 = 'activo',
  FALLIDO_GPON           = 'fallido_gpon',
  FALLIDO_WAN            = 'fallido_wan',
  DESAPROVISIONANDO      = 'desaprovisionando',
  TIMEOUT_ONLINE         = 'timeout_online',
  FALLIDO_SERVICE_PORT   = 'fallido_service_port',
  SUSPENDIDO             = 'suspendido',
}

export const FTTH_ESTADOS_ACTIVOS: FtthOnuEstado[] = [
  FtthOnuEstado.PENDIENTE,
  FtthOnuEstado.GPON_REGISTRADO,
  FtthOnuEstado.WAN_INYECTADO,
  FtthOnuEstado.ACTIVO,
  FtthOnuEstado.DESAPROVISIONANDO,
  FtthOnuEstado.SUSPENDIDO,
];

export const FTTH_ESTADOS_FALLIDOS: FtthOnuEstado[] = [
  FtthOnuEstado.FALLIDO_GPON,
  FtthOnuEstado.FALLIDO_WAN,
  FtthOnuEstado.TIMEOUT_ONLINE,
  FtthOnuEstado.FALLIDO_SERVICE_PORT,
];

@Entity('ftth_onu_registro')
@Index('idx_ftth_empresa', ['empresaId'])
@Index('idx_ftth_olt',     ['oltId'])
@Index('idx_ftth_estado',  ['estado'])
export class FtthOnuRegistro extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'contrato_id', unique: true })
  contratoId: string;

  @Column({ name: 'olt_id' })
  oltId: string;

  // ── Posición física en la OLT ─────────────────────────────
  @Column({ type: 'smallint', default: 0 })
  frame: number;

  @Column({ type: 'smallint' })
  slot: number;

  @Column({ type: 'smallint' })
  port: number;

  @Column({ name: 'onu_id', type: 'smallint' })
  onuId: number;

  @Column({ length: 16 })
  sn: string;

  @Column({ name: 'service_port_id', type: 'int', nullable: true })
  servicePortId: number | null;

  @Column({ type: 'smallint' })
  vlan: number;

  @Column({ name: 'lineprofile_id', type: 'int', nullable: true })
  lineprofileId: number | null;

  @Column({ name: 'srvprofile_id', type: 'int', nullable: true })
  srvprofileId: number | null;

  @Column({ name: 'traffic_index_down', type: 'int', nullable: true })
  trafficIndexDown: number | null;

  @Column({ name: 'traffic_index_up', type: 'int', nullable: true })
  trafficIndexUp: number | null;

  @Column({ name: 'description', type: 'varchar', length: 64, nullable: true })
  description: string | null;

  // ── Máquina de estados ────────────────────────────────────
  @Column({
    type: 'enum',
    enum: FtthOnuEstado,
    enumName: 'ftth_onu_estado',
    default: FtthOnuEstado.PENDIENTE,
  })
  estado: FtthOnuEstado;

  // Centinela del lock — si != null este registro está siendo procesado
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @Column({ name: 'intentos_gpon', type: 'smallint', default: 0 })
  intentosGpon: number;

  @Column({ name: 'intentos_wan', type: 'smallint', default: 0 })
  intentosWan: number;

  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;

  // ── Datos de salud/monitoreo (actualizados por cron batch-status) ──
  @Column({ name: 'run_state', type: 'varchar', length: 20, nullable: true })
  runState: string | null;

  @Column({ name: 'last_online', type: 'timestamptz', nullable: true })
  lastOnline: Date | null;

  @Column({ name: 'firmware_version', type: 'varchar', length: 100, nullable: true })
  firmwareVersion: string | null;

  @Column({ name: 'equipment_id', type: 'varchar', length: 100, nullable: true })
  equipmentId: string | null;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds: number | null;

  @Column({ name: 'traffic_table_id', type: 'int', nullable: true })
  trafficTableId: number | null;

}

// ── Helpers (fuera de la clase para evitar get/set con SWC) ──────────
export function ftthEstaActivo(r: FtthOnuRegistro): boolean {
  return r.estado === FtthOnuEstado.ACTIVO;
}

export function ftthEstaFallido(r: FtthOnuRegistro): boolean {
  return r.estado === FtthOnuEstado.FALLIDO_GPON ||
         r.estado === FtthOnuEstado.FALLIDO_WAN;
}

export function ftthNecesitaRecovery(r: FtthOnuRegistro): boolean {
  if (!r.lockedAt) return false;
  const minutos = (Date.now() - r.lockedAt.getTime()) / 60_000;
  return minutos > 10;
}
