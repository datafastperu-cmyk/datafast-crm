import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, Index, CreateDateColumn,
} from 'typeorm';
import { OltDispositivo } from './olt-dispositivo.entity';

export type SyncJobEstado = 'pending' | 'running' | 'completed' | 'failed';

@Entity('olt_sync_jobs')
@Index('idx_olt_sync_empresa', ['empresaId'])
@Index('idx_olt_sync_olt', ['oltId', 'iniciadoEn'])
export class OltSyncJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  estado: SyncJobEstado;

  @Column({ type: 'smallint', default: 0 })
  progreso: number;

  @Column({ type: 'jsonb', default: {} })
  resultado: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'iniciado_en', type: 'timestamptz' })
  iniciadoEn: Date;

  @Column({ name: 'completado_en', type: 'timestamptz', nullable: true })
  completadoEn: Date | null;

  @ManyToOne(() => OltDispositivo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'olt_id' })
  olt: OltDispositivo;
}
