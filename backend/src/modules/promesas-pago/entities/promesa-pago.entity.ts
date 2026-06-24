import { Entity, Column, Index } from 'typeorm';
import { BaseModel }             from '../../../common/entities/base.entity';

export enum EstadoPromesa {
  ACTIVA            = 'activa',
  VENCIDA_PENDIENTE = 'vencida_pendiente', // expiró, corte en cola (router caído)
  VENCIDA           = 'vencida',
  CUMPLIDA          = 'cumplida',
  CANCELADA         = 'cancelada',
}

@Entity('promesas_pago')
@Index(['empresaId', 'estado'])
@Index(['fechaVencimiento'], { where: `estado = 'activa'` })
export class PromesaPago extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ type: 'varchar', length: 25, default: EstadoPromesa.ACTIVA })
  estado: EstadoPromesa;

  @Column({ name: 'fecha_vencimiento', type: 'date' })
  fechaVencimiento: string;

  @Column({ name: 'monto_prometido', type: 'decimal', precision: 10, scale: 2, default: 0 })
  montoPrometido: number;

  @Column({ name: 'deuda_al_crear', type: 'decimal', precision: 10, scale: 2, default: 0 })
  deudaAlCrear: number;

  // Snapshots al momento de crear — inmutables aunque el contrato cambie
  @Column({ name: 'ip_cliente_snapshot', type: 'inet', nullable: true })
  ipClienteSnapshot: string;

  @Column({ name: 'router_id_snapshot', nullable: true })
  routerIdSnapshot: string;

  @Column({ name: 'usuario_pppoe_snapshot', length: 100, nullable: true })
  usuarioPppoeSnapshot: string;

  @Column({ name: 'contrato_estado_previo', length: 30, nullable: true })
  contratoEstadoPrevio: string;

  @Column({ type: 'text', nullable: true })
  motivo: string;

  @Column({ name: 'otorgada_por', nullable: true })
  otorgadaPor: string;

  @Column({ name: 'resuelta_por', nullable: true })
  resueltaPor: string;

  @Column({ name: 'resuelta_en', type: 'timestamptz', nullable: true })
  resueltaEn: Date;

  @Column({ name: 'pago_id_cumplimiento', nullable: true })
  pagoIdCumplimiento: string;

  @Column({ name: 'mikrotik_aplicado', default: false })
  mikrotikAplicado: boolean;

  @Column({ name: 'mikrotik_aplicado_en', type: 'timestamptz', nullable: true })
  mikrotikAplicadoEn: Date;

  @Column({ name: 'mikrotik_reintentos', type: 'smallint', default: 0 })
  mikrotikReintentos: number;

  @Column({ name: 'mikrotik_ultimo_error', type: 'text', nullable: true })
  mikrotikUltimoError: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;
}
