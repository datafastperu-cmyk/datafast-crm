import {
  Column, Entity, ManyToMany, JoinTable,
  ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseModel } from '../../../common/entities/base.entity';
import { Permiso } from './permiso.entity';
import { Usuario } from './usuario.entity';

@Entity('roles')
export class Rol extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @ApiProperty({ example: 'Cajero' })
  @Column({ length: 80 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ name: 'es_sistema', default: false })
  esSistema: boolean;

  // ── Relaciones ───────────────────────────────────────────────
  @ManyToMany(() => Permiso, (permiso) => permiso.roles, { eager: true })
  @JoinTable({
    name: 'roles_permisos',
    joinColumn:        { name: 'rol_id',    referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permiso_id', referencedColumnName: 'id' },
  })
  permisos: Permiso[];

  @ManyToMany(() => Usuario, (u) => u.roles)
  usuarios: Usuario[];

  // Helper: lista de códigos de permiso
  get codigosPermisos(): string[] {
    return this.permisos?.map((p) => p.codigo) ?? [];
  }
}
