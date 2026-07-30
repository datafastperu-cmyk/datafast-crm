import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

// Banner promocional del Portal del Cliente (pestaña Banners).
@Entity('portal_banner')
@Index(['empresaId', 'activo', 'orden'])
export class PortalBanner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  titulo: string | null;

  @Column({ name: 'imagen_url', type: 'varchar', length: 255 })
  imagenUrl: string;

  @Column({ name: 'enlace_url', type: 'varchar', length: 255, nullable: true })
  enlaceUrl: string | null;

  @Column({ type: 'smallint', default: 0 })
  orden: number;

  @Column({ name: 'vigente_desde', type: 'date', nullable: true })
  vigenteDesde: string | null;

  @Column({ name: 'vigente_hasta', type: 'date', nullable: true })
  vigenteHasta: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
