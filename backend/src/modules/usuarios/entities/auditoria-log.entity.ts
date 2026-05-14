import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, Index,
} from 'typeorm';

@Entity('auditoria_logs')
@Index(['empresaId', 'createdAt'])
@Index(['usuarioId'])
@Index(['modulo', 'accion'])
export class AuditoriaLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'empresa_id', nullable: true })
  empresaId: string;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId: string;

  @Column({ name: 'usuario_email', length: 150, nullable: true })
  usuarioEmail: string;

  // Acción
  @Column({ length: 80 })
  accion: string;   // 'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN_FAIL'

  @Column({ length: 60 })
  modulo: string;

  @Column({ name: 'entidad_id', length: 100, nullable: true })
  entidadId: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  // Contexto HTTP
  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string;

  @Column({ name: 'metodo_http', length: 10, nullable: true })
  metodoHttp: string;

  @Column({ length: 500, nullable: true })
  ruta: string;

  // Datos
  @Column({ name: 'datos_anteriores', type: 'jsonb', nullable: true })
  datosAnteriores: Record<string, any>;

  @Column({ name: 'datos_nuevos', type: 'jsonb', nullable: true })
  datosNuevos: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
