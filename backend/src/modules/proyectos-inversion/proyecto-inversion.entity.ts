import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export enum EstadoProyecto {
  ACTIVO    = 'activo',
  COMPLETADO = 'completado',
  CANCELADO = 'cancelado',
}

@Entity('proyectos_inversion')
@Index(['empresaId', 'sectorId'])
export class ProyectoInversion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'nombre_proyecto', length: 200 })
  nombreProyecto: string;

  // FK a zonas.id — sin @ManyToOne para mantener consistencia con el resto del codebase
  @Column({ name: 'sector_id' })
  sectorId: string;

  // CapEx total del proyecto (materiales, OLT, mano de obra, fusiones, etc.)
  @Column({ name: 'inversion_inicial', type: 'decimal', precision: 14, scale: 2 })
  inversionInicial: number;

  // Tasa de descuento anual expresada como fracción: 0.10 = 10 %. Usada para VAN.
  @Column({ name: 'tasa_descuento', type: 'decimal', precision: 6, scale: 4 })
  tasaDescuento: number;

  @Column({ name: 'fecha_inicio', type: 'date' })
  fechaInicio: string;

  @Column({ type: 'text', nullable: true })
  descripcion?: string;

  @Column({ type: 'enum', enum: EstadoProyecto, default: EstadoProyecto.ACTIVO })
  estado: EstadoProyecto;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
