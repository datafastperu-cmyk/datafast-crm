import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  BaseEntity,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

// ─── Entidad base para todas las entidades del sistema ─────────
// Provee: id UUID, created_at, updated_at, deleted_at (soft delete)
export abstract class BaseModel extends BaseEntity {
  @ApiProperty({ description: 'ID único UUID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Fecha de creación' })
  @CreateDateColumn({
    type: 'timestamptz',
    name: 'created_at',
    comment: 'Fecha y hora de creación (con timezone)',
  })
  createdAt: Date;

  @ApiProperty({ description: 'Fecha de última actualización' })
  @UpdateDateColumn({
    type: 'timestamptz',
    name: 'updated_at',
    comment: 'Fecha y hora de última modificación',
  })
  updatedAt: Date;

  @DeleteDateColumn({
    type: 'timestamptz',
    name: 'deleted_at',
    nullable: true,
    comment: 'Soft delete — null = activo',
  })
  deletedAt?: Date;
}
