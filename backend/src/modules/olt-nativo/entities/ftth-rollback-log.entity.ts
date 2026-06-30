import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RollbackMotivo =
  | 'timeout_online'
  | 'gpon_failed'
  | 'manual_desaprovisionar'
  | 'recovery_lock_expirado';

@Entity('ftth_rollback_log')
@Index('idx_frl_registro', ['registroId'])
@Index('idx_frl_empresa',  ['empresaId'])
@Index('idx_frl_contrato', ['contratoId'])
export class FtthRollbackLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'registro_id', type: 'uuid' })
  registroId: string;

  @Column({ name: 'contrato_id', type: 'uuid' })
  contratoId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ type: 'varchar', length: 50 })
  motivo: RollbackMotivo;

  @Column({ name: 'estado_previo', type: 'varchar', length: 30 })
  estadoPrevio: string;

  @Column({ name: 'ssh_exitoso', type: 'boolean', default: false })
  sshExitoso: boolean;

  @Column({ name: 'ssh_error', type: 'text', nullable: true })
  sshError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
