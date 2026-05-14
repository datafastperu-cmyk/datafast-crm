import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('auditoria_logs')
export class AuditoriaLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true }) usuarioId: string;
  @Column({ nullable: true }) usuarioEmail: string;
  @Column({ nullable: true }) empresaId: string;
  @Column({ nullable: true }) accion: string;
  @Column({ nullable: true }) entidad: string;
  @Column({ nullable: true }) entidadId: string;
  @Column({ type: 'jsonb', nullable: true }) datosAnteriores: any;
  @Column({ type: 'jsonb', nullable: true }) datosNuevos: any;
  @Column({ nullable: true }) ip: string;
  @Column({ nullable: true }) userAgent: string;
  @CreateDateColumn() createdAt: Date;
}
