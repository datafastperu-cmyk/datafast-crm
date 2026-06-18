import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index,
} from 'typeorm';

export enum EstadoEntrega {
  ENCOLADO   = 'ENCOLADO',
  EN_PROCESO = 'EN_PROCESO',
  ENVIADO    = 'ENVIADO',
  NO_ENVIADO = 'NO_ENVIADO',
  FALLIDO    = 'FALLIDO',
  ENTREGADO  = 'ENTREGADO',
  LEIDO      = 'LEIDO',
}

@Entity('notificaciones_logs')
@Index('idx_notif_logs_empresa',         ['empresaId'])
@Index('idx_notif_logs_contrato',        ['contratoId'])
@Index('idx_notif_logs_created_at',      ['createdAt'])
@Index('idx_notif_logs_estado',          ['estadoEntrega'])
@Index('idx_notif_logs_provider_msg_id', ['providerMessageId'])
export class NotificacionLog {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid', nullable: true })
  empresaId: string | null;

  @Column({ name: 'contrato_id', type: 'uuid', nullable: true })
  contratoId: string | null;

  @Column({ length: 30 })
  telefono: string;

  @Column({ length: 20, default: 'WHATSAPP' })
  canal: string;

  @Column({ name: 'tipo_template', length: 50 })
  tipoTemplate: string;

  @Column({
    name: 'estado_entrega',
    type: 'enum',
    enum: EstadoEntrega,
    default: EstadoEntrega.ENCOLADO,
  })
  estadoEntrega: EstadoEntrega;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 100, nullable: true })
  providerMessageId: string | null;

  @Column({ name: 'proveedor', type: 'varchar', length: 40, nullable: true })
  proveedor: string | null;

  @Column({ name: 'error_detalle', type: 'text', nullable: true })
  errorDetalle: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
