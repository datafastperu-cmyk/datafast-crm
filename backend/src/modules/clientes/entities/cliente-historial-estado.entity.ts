import {
  Entity, Column, PrimaryGeneratedColumn, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Cliente, EstadoCliente } from './cliente.entity';

@Entity('clientes_historial_estados')
@Index(['clienteId', 'createdAt'])
export class ClienteHistorialEstado {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({
    name: 'estado_anterior',
    type: 'enum',
    enum: EstadoCliente,
    nullable: true,
  })
  estadoAnterior: EstadoCliente;

  @Column({
    name: 'estado_nuevo',
    type: 'enum',
    enum: EstadoCliente,
  })
  estadoNuevo: EstadoCliente;

  @Column({ type: 'text', nullable: true })
  motivo: string;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId: string;

  @Column({ default: false })
  automatico: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Cliente, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cliente_id' })
  cliente: Cliente;
}
