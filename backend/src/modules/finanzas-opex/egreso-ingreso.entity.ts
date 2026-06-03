import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export enum TipoMovimiento {
  INGRESO_OTRO = 'INGRESO_OTRO',
  EGRESO       = 'EGRESO',
}

export enum CategoriaMovimiento {
  SERVICIOS_LUZ_AGUA = 'SERVICIOS_LUZ_AGUA',
  INTERNET_PROVEEDOR = 'INTERNET_PROVEEDOR',
  PLANILLA_EMPLEADOS = 'PLANILLA_EMPLEADOS',
  ALQUILERES         = 'ALQUILERES',
  OTROS              = 'OTROS',
}

export enum EstadoMovimiento {
  PAGADO         = 'PAGADO',
  PENDIENTE_PAGO = 'PENDIENTE_PAGO',
}

@Entity('egresos_ingresos')
@Index(['empresaId', 'fechaRegistro'])
export class EgresoIngreso {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ type: 'enum', enum: TipoMovimiento })
  tipo: TipoMovimiento;

  @Column({ type: 'enum', enum: CategoriaMovimiento, default: CategoriaMovimiento.OTROS })
  categoria: CategoriaMovimiento;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ name: 'fecha_registro', type: 'date' })
  fechaRegistro: string;

  @Column({ type: 'text', nullable: true })
  descripcion?: string;

  @Column({ name: 'es_recurrente', default: false })
  esRecurrente: boolean;

  // Día del mes (1–31) en que se activa el recordatorio. Solo aplica si esRecurrente = true.
  @Column({ name: 'dia_vencimiento', type: 'smallint', nullable: true })
  diaVencimiento?: number;

  @Column({ type: 'enum', enum: EstadoMovimiento, default: EstadoMovimiento.PAGADO })
  estado: EstadoMovimiento;

  // UUID de la plantilla recurrente que originó este registro. Evita duplicados mensuales.
  @Column({ name: 'plantilla_id', nullable: true })
  plantillaId?: string;

  // Zona geográfica a la que se asigna este egreso (para cálculo de flujos por sector).
  @Column({ name: 'sector_id', nullable: true })
  sectorId?: string;

  // Proyecto CapEx al que se imputa directamente este egreso (flujos VAN/TIR).
  @Column({ name: 'proyecto_inversion_id', nullable: true })
  proyectoInversionId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
