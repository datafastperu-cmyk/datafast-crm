import {
  Column, Entity, ManyToMany, JoinTable,
  BeforeInsert, BeforeUpdate,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { ApiProperty, ApiHideProperty } from '@nestjs/swagger';
import { BaseModel } from '../../../common/entities/base.entity';
import { Rol } from './rol.entity';

export enum EstadoUsuario {
  ACTIVO                  = 'activo',
  INACTIVO                = 'inactivo',
  BLOQUEADO               = 'bloqueado',
  PENDIENTE_VERIFICACION  = 'pendiente_verificacion',
}

@Entity('usuarios')
export class Usuario extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Identidad ─────────────────────────────────────────────
  @ApiProperty({ example: 'Juan' })
  @Column({ length: 100 })
  nombres: string;

  @ApiProperty({ example: 'Pérez García' })
  @Column({ length: 100 })
  apellidos: string;

  @ApiProperty({ example: 'juan@fibranet.pe' })
  @Column({ length: 150 })
  email: string;

  @Column({ length: 20, nullable: true })
  telefono: string;

  @Column({ name: 'foto_url', length: 500, nullable: true })
  fotoUrl: string;

  // ── Seguridad (excluidos de serialización) ────────────────
  @Exclude()
  @ApiHideProperty()
  @Column({ name: 'password_hash', length: 250 })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: EstadoUsuario,
    default: EstadoUsuario.ACTIVO,
  })
  estado: EstadoUsuario;

  @Column({ name: 'email_verificado', default: false })
  emailVerificado: boolean;

  @Exclude()
  @Column({ name: 'token_verificacion', length: 200, nullable: true })
  tokenVerificacion: string;

  @Column({ name: 'ultimo_acceso', type: 'timestamptz', nullable: true })
  ultimoAcceso: Date;

  @Column({ name: 'intentos_fallidos', default: 0 })
  intentosFallidos: number;

  @Column({ name: 'bloqueado_hasta', type: 'timestamptz', nullable: true })
  bloqueadoHasta: Date;

  @Exclude()
  @Column({ name: 'refresh_token_hash', length: 500, nullable: true })
  refreshTokenHash: string;

  // ── Preferencias ──────────────────────────────────────────
  @Column({ name: 'zona_horaria', length: 50, default: 'America/Lima' })
  zonaHoraria: string;

  @Column({ length: 10, default: 'es' })
  idioma: string;

  @Column({ length: 20, default: 'dark' })
  tema: string;

  // ── Relaciones ────────────────────────────────────────────
  @ManyToMany(() => Rol, (rol) => rol.usuarios, { eager: true })
  @JoinTable({
    name: 'usuarios_roles',
    joinColumn:        { name: 'usuario_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'rol_id',     referencedColumnName: 'id' },
  })
  roles: Rol[];

  // ── Helpers computados (no columnas) ─────────────────────
  get nombreCompleto(): string {
    return `${this.nombres} ${this.apellidos}`;
  }

  get nombresRoles(): string[] {
    return this.roles?.map((r) => r.nombre) ?? [];
  }

  get permisos(): string[] {
    const set = new Set<string>();
    this.roles?.forEach((r) => r.codigosPermisos.forEach((p) => set.add(p)));
    return [...set];
  }

  get estaActivo(): boolean {
    return this.estado === EstadoUsuario.ACTIVO && !this.deletedAt;
  }

  get estaBloqueado(): boolean {
    if (this.estado === EstadoUsuario.BLOQUEADO) return true;
    if (this.bloqueadoHasta && this.bloqueadoHasta > new Date()) return true;
    return false;
  }
}
