import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('entity_versions')
@Index(['usuarioId', 'empresaId', 'revertido', 'createdAt'])
@Index(['tabla', 'entidadId'])
export class EntityVersion {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'empresa_id',    nullable: true }) empresaId:     string;
  @Column({ name: 'usuario_id',    nullable: true }) usuarioId:     string;
  @Column({ name: 'usuario_email', nullable: true }) usuarioEmail:  string;

  @Column({ length: 50  }) modulo:    string;
  @Column({ length: 100 }) tabla:     string;
  @Column({ name: 'entidad_id', length: 100 }) entidadId: string;
  @Column({ length: 20  }) accion:    string;

  @Column({ name: 'snapshot_anterior',  type: 'jsonb', nullable: true }) snapshotAnterior:  Record<string, any>;
  @Column({ name: 'snapshot_posterior', type: 'jsonb', nullable: true }) snapshotPosterior: Record<string, any>;
  @Column({ name: 'redo_snapshot',      type: 'jsonb', nullable: true }) redoSnapshot:      Record<string, any>;

  @Column({ nullable: true }) descripcion: string;
  @Column({ default: true  }) reversible:  boolean;
  @Column({ default: false }) revertido:   boolean;

  @Column({ name: 'revertido_en', type: 'timestamptz', nullable: true }) revertidoEn: Date;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
