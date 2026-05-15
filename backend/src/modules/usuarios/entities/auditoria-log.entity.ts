import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('auditoria_logs')
export class AuditoriaLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true }) usuarioId: string;
  @Column({ nullable: true }) usuarioEmail: string;
  @Column({ nullable: true }) empresaId: string;
  @Column({ nullable: true }) modulo: string;
  @Column({ nullable: true }) accion: string;
  @Column({ nullable: true }) entidad: string;
  @Column({ nullable: true }) entidadId: string;
  @Column({ nullable: true }) ipAddress: string;
  @Column({ nullable: true }) ip: string;
  @Column({ nullable: true }) userAgent: string;
  @Column({ nullable: true }) descripcion: string;
  @Column({ nullable: true }) resultado: string;
  @Column({ nullable: true }) exitoso: boolean;
  @Column({ nullable: true }) metodoHttp: string;
  @Column({ nullable: true }) url: string;
  @Column({ nullable: true }) ruta: string;
  @Column({ nullable: true }) statusCode: number;
  @Column({ type: 'jsonb', nullable: true }) datosAnteriores: any;
  @Column({ type: 'jsonb', nullable: true }) datosNuevos: any;
  @Column({ type: 'jsonb', nullable: true }) metadatos: any;
  @CreateDateColumn() createdAt: Date;
}
