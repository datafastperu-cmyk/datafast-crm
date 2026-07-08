import {
  Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

// Read-model: snapshot del estado OBSERVADO de las ONUs en la OLT, poblado por el
// job de reconciliación (una pasada SSH). La UI y el drift leen de aquí (instantáneo),
// no de SSH en vivo. Se hace UPSERT por (olt_id, slot, port, sn) en cada reconcile.
export type OnuInventarioOrigen = 'configurada' | 'autofind';

@Entity('olt_onu_inventario')
@Index('idx_olt_onu_inv_empresa', ['empresaId'])
@Index('idx_olt_onu_inv_olt',     ['oltId'])
@Index('uq_olt_onu_inv', ['oltId', 'slot', 'port', 'sn'], { unique: true })
export class OltOnuInventario {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId: string;
  @Column({ name: 'olt_id',     type: 'uuid' }) oltId:     string;

  @Column({ type: 'int' }) slot: number;
  @Column({ type: 'int' }) port: number;
  @Column({ name: 'onu_id', type: 'int', nullable: true }) onuId: number | null;
  @Column({ type: 'varchar', length: 32 }) sn: string;

  // Estado operativo resuelto: online | apagada | ruptura_fibra | desactivada | offline | no_aprovisionada
  @Column({ name: 'estado_operativo', type: 'varchar', length: 24 }) estadoOperativo: string;
  @Column({ name: 'control_flag', type: 'varchar', length: 16, nullable: true }) controlFlag: string | null;
  @Column({ name: 'run_state',    type: 'varchar', length: 16, nullable: true }) runState:    string | null;
  @Column({ name: 'rx_power_dbm', type: 'double precision', nullable: true }) rxPowerDbm: number | null;

  // Cruce con contrato (desired state)
  @Column({ name: 'sin_contrato',   type: 'boolean', default: true }) sinContrato: boolean;
  @Column({ name: 'contrato_id',    type: 'uuid', nullable: true }) contratoId: string | null;
  @Column({ name: 'numero_contrato', type: 'varchar', length: 40, nullable: true }) numeroContrato: string | null;
  @Column({ name: 'cliente', type: 'varchar', length: 200, nullable: true }) cliente: string | null;

  @Column({ type: 'varchar', length: 12, default: 'configurada' }) origen: OnuInventarioOrigen;

  @Column({ name: 'snapshot_at', type: 'timestamptz' }) snapshotAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
