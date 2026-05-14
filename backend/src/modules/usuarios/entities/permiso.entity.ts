import { Column, Entity, ManyToMany, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Rol } from './rol.entity';

@Entity('permisos')
export class Permiso {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'clientes:create' })
  @Column({ unique: true, length: 80 })
  codigo: string;

  @Column({ length: 150 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ length: 60 })
  modulo: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToMany(() => Rol, (rol) => rol.permisos)
  roles: Rol[];
}
