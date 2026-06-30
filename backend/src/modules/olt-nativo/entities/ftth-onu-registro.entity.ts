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

  // ── Helpers ───────────────────────────────────────────────
  get estaActivo(): boolean {
    return this.estado === FtthOnuEstado.ACTIVO;
  }

  get estaFallido(): boolean {
    return this.estado === FtthOnuEstado.FALLIDO_GPON ||
           this.estado === FtthOnuEstado.FALLIDO_WAN;
  }

  get necesitaRecovery(): boolean {
    if (!this.lockedAt) return false;
    const minutos = (Date.now() - this.lockedAt.getTime()) / 60_000;
    return minutos > 10;
  }
}
