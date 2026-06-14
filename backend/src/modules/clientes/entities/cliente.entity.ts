import {
  Entity, Column, ManyToOne, OneToMany,
  JoinColumn, Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { BaseModel } from '../../../common/entities/base.entity';

export enum EstadoCliente {
  PENDIENTE_INSTALACION = 'pendiente_instalacion',
  ACTIVO                = 'activo',
  SUSPENDIDO            = 'suspendido',
  BAJA_DEFINITIVA       = 'baja_definitiva',
}

export enum TipoDocumento {
  DNI       = 'dni',
  RUC       = 'ruc',
  CE        = 'ce',
  PASAPORTE = 'pasaporte',
}

export enum TipoServicio {
  FTTH     = 'ftth',
  WISP     = 'wisp',
  DEDICADO = 'dedicado',
  MIXTO    = 'mixto',
}

@Entity('clientes')
@Index(['empresaId', 'estado'])
@Index(['empresaId', 'tipoDocumento', 'numeroDocumento'])
export class Cliente extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'tipo_documento', type: 'enum', enum: TipoDocumento, default: TipoDocumento.DNI })
  tipoDocumento: TipoDocumento;

  @Column({ name: 'numero_documento', length: 20 })
  numeroDocumento: string;

  @Column({ length: 100 })
  nombres: string;

  @Column({ name: 'apellido_paterno', length: 80, nullable: true, default: '' })
  apellidoPaterno: string;

  @Column({ name: 'apellido_materno', length: 80, nullable: true })
  apellidoMaterno: string;

  @Column({ name: 'nombre_completo', insert: false, update: false, nullable: true })
  nombreCompleto: string;

  @Column({ length: 150, nullable: true })
  email: string;

  @Column({ length: 20 })
  telefono: string;

  @Column({ name: 'telefono_alt', length: 20, nullable: true })
  telefonoAlt: string;

  @Column({ length: 20, nullable: true })
  whatsapp: string;

  @Column({ type: 'text' })
  direccion: string;

  @Column({ type: 'text', nullable: true })
  referencia: string;

  @Column({ length: 100, nullable: true })
  departamento: string;

  @Column({ length: 100, nullable: true })
  provincia: string;

  @Column({ length: 100, nullable: true })
  distrito: string;

  @Column({ length: 10, nullable: true })
  ubigeo: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  @Column({ name: 'precision_gps', type: 'decimal', precision: 8, scale: 2, nullable: true })
  precisionGps: number;

  @Column({ name: 'foto_url', length: 500, nullable: true })
  fotoUrl: string;

  @Column({ name: 'foto_instalacion_url', length: 500, nullable: true })
  fotoInstalacionUrl: string;

  @Column({ type: 'enum', enum: EstadoCliente, default: EstadoCliente.PENDIENTE_INSTALACION })
  estado: EstadoCliente;

  @Column({ name: 'fecha_estado', type: 'timestamptz', default: () => 'NOW()' })
  fechaEstado: Date;

  @Column({ name: 'motivo_estado', type: 'text', nullable: true })
  motivoEstado: string;

  @Column({ name: 'tipo_servicio', type: 'enum', enum: TipoServicio, nullable: true, default: TipoServicio.FTTH })
  tipoServicio: TipoServicio;

  @Column({ name: 'codigo_cliente', length: 30, nullable: true })
  codigoCliente: string;

  @Column({ name: 'usuario_portal', length: 50, nullable: true })
  usuarioPortal: string;

  @Exclude()
  @Column({ name: 'password_portal', length: 100, nullable: true })
  passwordPortal: string;

  @Column({ name: 'notas_internas', type: 'text', nullable: true })
  notasInternas: string;

  @Column({ name: 'nota_baja', type: 'text', nullable: true })
  notaBaja: string;

  @Column({ name: 'etiquetas', type: 'text', array: true, nullable: true })
  etiquetas: string[];

  @Column({ name: 'es_empresa', default: false })
  esEmpresa: boolean;

  @Column({ name: 'ruc_empresa', length: 20, nullable: true })
  rucEmpresa: string;

  @Column({ name: 'razon_social', length: 200, nullable: true })
  razonSocial: string;

  @Column({ name: 'referido_por', nullable: true })
  referidoPorId: string;

  @Column({ name: 'zona_id', nullable: true })
  zonaId: string;

  @Column({ name: 'vendedor_id', nullable: true })
  vendedorId: string;

  @Column({ name: 'reniec_consultado', default: false })
  reniecConsultado: boolean;

  @Column({ name: 'reniec_consultado_en', type: 'timestamptz', nullable: true })
  reniecConsultadoEn: Date;

  @Column({ name: 'reniec_datos_raw', type: 'jsonb', nullable: true })
  reniecDatosRaw: Record<string, any>;

  @Column({ name: 'facturacion_config', type: 'jsonb', nullable: true })
  facturacionConfig: Record<string, any> | null;

  @Column({ name: 'notificaciones_config', type: 'jsonb', nullable: true })
  notificacionesConfig: Record<string, any> | null;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @OneToMany(() => ClienteHistorialEstado, (h) => h.cliente)
  historialEstados: ClienteHistorialEstado[];
}

@Entity('clientes_historial_estados')
@Index(['clienteId', 'createdAt'])
export class ClienteHistorialEstado {
  @Column({ type: 'bigint', primary: true, generated: 'increment' })
  id: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'estado_anterior', type: 'enum', enum: EstadoCliente, nullable: true })
  estadoAnterior: EstadoCliente;

  @Column({ name: 'estado_nuevo', type: 'enum', enum: EstadoCliente })
  estadoNuevo: EstadoCliente;

  @Column({ type: 'text', nullable: true })
  motivo: string;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId: string;

  @Column({ default: false })
  automatico: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @ManyToOne(() => Cliente, (c) => c.historialEstados)
  @JoinColumn({ name: 'cliente_id' })
  cliente: Cliente;
}
