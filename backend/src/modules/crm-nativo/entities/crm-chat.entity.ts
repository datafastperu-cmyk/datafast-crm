import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

@Entity('crm_chats')
@Index('idx_crm_chats_empresa', ['empresaId'])
export class CrmChat {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'wa_chat_id', length: 60 })
  waChatId: string;

  @Column({ length: 30 })
  telefono: string;

  @Column({ name: 'nombre_contacto', type: 'varchar', length: 120, nullable: true })
  nombreContacto: string | null;

  @Column({ name: 'ultimo_mensaje', type: 'text', nullable: true })
  ultimoMensaje: string | null;

  @Column({ name: 'ultimo_msg_at', type: 'timestamptz', nullable: true })
  ultimoMsgAt: Date | null;

  @Column({ name: 'no_leidos', type: 'smallint', default: 0 })
  noLeidos: number;

  // `telefono` guarda un identificador LID de Meta, no un número de abonado:
  // no sirve para cruzar con la ficha del cliente ni para marcar.
  @Column({ name: 'es_lid', type: 'boolean', default: false })
  esLid: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
