import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export enum SagaStatus {
  RUNNING              = 'running',
  COMPLETED            = 'completed',
  FAILED               = 'failed',
  COMPENSATING         = 'compensating',
  COMPENSATION_FAILED  = 'compensation_failed',
}

export enum SagaTipo {
  ACTIVAR_CONTRATO  = 'ACTIVAR_CONTRATO',
  BAJA_DEFINITIVA   = 'BAJA_DEFINITIVA',
  MIGRACION_PLAN    = 'MIGRACION_PLAN',
  RELOCALIZAR       = 'RELOCALIZAR',
}

export interface SagaPaso {
  paso:       number;
  nombre:     string;
  resultado:  'OK' | 'FAIL' | 'SKIPPED';
  error?:     string;
  duracionMs?: number;
  ejecutadoEn: string;
}

@Entity('saga_log')
@Index(['empresaId', 'status'])
@Index(['contratoId', 'iniciadoEn'])
@Index(['status', 'iniciadoEn'])
export class SagaLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'saga_tipo', length: 50 })
  sagaTipo: SagaTipo;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'status', type: 'varchar', length: 30, default: SagaStatus.RUNNING })
  status: SagaStatus;

  @Column({ name: 'paso_actual', type: 'smallint', default: 0 })
  pasoActual: number;

  @Column({ name: 'pasos_totales', type: 'smallint' })
  pasosTotales: number;

  @Column({ name: 'pasos', type: 'jsonb', default: [] })
  pasos: SagaPaso[];

  @Column({ name: 'actor_id', nullable: true })
  actorId: string;

  @Column({ name: 'trace_id', nullable: true })
  traceId: string;

  @Column({ name: 'error', type: 'text', nullable: true })
  error: string;

  @CreateDateColumn({ name: 'iniciado_en', type: 'timestamptz' })
  iniciadoEn: Date;

  @Column({ name: 'completado_en', type: 'timestamptz', nullable: true })
  completadoEn: Date;
}
