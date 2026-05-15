import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('auditoria_logs')
export class AuditoriaLog {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column({ name: 'empresa_id',    nullable: true }) empresaId: string;
  @Column({ name: 'usuario_id',    nullable: true }) usuarioId: string;
  @Column({ name: 'usuario_email', nullable: true }) usuarioEmail: string;
  @Column({ name: 'accion'  }) accion: string;
  @Column({ name: 'modulo'  }) modulo: string;
  @Column({ name: 'entidad_id',    nullable: true }) entidadId: string;
  @Column({ name: 'descripcion',   nullable: true }) descripcion: string;
  @Column({ name: 'ip_address',    nullable: true }) ipAddress: string;
  @Column({ name: 'user_agent',    nullable: true }) userAgent: string;
  @Column({ name: 'metodo_http',   nullable: true }) metodoHttp: string;
  @Column({ name: 'ruta',          nullable: true }) ruta: string;
  @Column({ name: 'datos_anteriores', type: 'jsonb', nullable: true }) datosAnteriores: any;
  @Column({ name: 'datos_nuevos',  type: 'jsonb', nullable: true }) datosNuevos: any;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
