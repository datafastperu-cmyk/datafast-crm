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

  // node-postgres devuelve NUMERIC como string; el transformer garantiza número JS en runtime.
  @Column({
    name: 'inversion_inicial',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: { to: (v: number) => v, from: (v: string) => parseFloat(v) },
  })
  inversionInicial: number;

  // Tasa de descuento anual como fracción: 0.10 = 10 %. Convertida a tasa mensual en el servicio.
  @Column({
    name: 'tasa_descuento',
    type: 'numeric',
    precision: 6,
    scale: 4,
    transformer: { to: (v: number) => v, from: (v: string) => parseFloat(v) },
  })
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
