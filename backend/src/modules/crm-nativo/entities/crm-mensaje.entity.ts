import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index,
} from 'typeorm';

@Entity('crm_mensajes')
@Index('idx_crm_mensajes_chat',    ['chatId', 'createdAt'])
@Index('idx_crm_mensajes_empresa', ['empresaId'])
export class CrmMensaje {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'chat_id', type: 'uuid' })
  chatId: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'wa_msg_id', type: 'varchar', length: 100, nullable: true })
  waMsgId: string | null;

  @Column({ type: 'varchar', length: 10 })
  direction: 'INBOUND' | 'OUTBOUND';

  @Column({ type: 'varchar', length: 120, nullable: true })
  agente: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'media_url', type: 'text', nullable: true })
  mediaUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
