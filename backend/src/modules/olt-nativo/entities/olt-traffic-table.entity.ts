import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type TrafficTableTipo   = 'upstream' | 'downstream' | 'combinado';
export type TrafficTableOrigen = 'erp' | 'olt';
export type TrafficTableEstado = 'active' | 'syncing' | 'error';

@Entity('olt_traffic_tables')
@Index('idx_olt_tt_empresa', ['empresaId'])
@Index('idx_olt_tt_olt',     ['oltId'])
export class OltTrafficTable {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId:  string;
  @Column({ name: 'olt_id',     type: 'uuid' }) oltId:      string;
  @Column({ name: 'traffic_id', type: 'int'  }) trafficId:  number;
  @Column({ type: 'varchar', length: 64 })       nombre:     string;
  @Column({ name: 'cir_kbps', type: 'int', nullable: true }) cirKbps: number | null;
  @Column({ name: 'pir_kbps', type: 'int', nullable: true }) pirKbps: number | null;

  @Column({ type: 'varchar', length: 20, default: 'combinado' })
  tipo: TrafficTableTipo;

  @Column({ type: 'varchar', length: 10, default: 'olt' })
  origen: TrafficTableOrigen;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  estado: TrafficTableEstado;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
