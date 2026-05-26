import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Enums ────────────────────────────────────────────────────
export enum EstadoContrato {
  PENDIENTE_INSTALACION = 'pendiente_instalacion',
  ACTIVO                = 'activo',
  SUSPENDIDO_MORA       = 'suspendido_mora',
  SUSPENDIDO_MANUAL     = 'suspendido_manual',
  PRORROGA              = 'prorroga',
  BAJA_SOLICITADA       = 'baja_solicitada',
  BAJA_DEFINITIVA       = 'baja_definitiva',
  MIGRADO               = 'migrado',
}

// ─── Contrato ─────────────────────────────────────────────────
@Entity('contratos')
@Index(['empresaId', 'estado'])
@Index(['empresaId', 'clienteId'])
@Index(['ipAsignada'])
@Index(['usuarioPppoe'])
export class Contrato extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── FK sin carga eagerly (manual join cuando se necesite) ──
  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'router_id', nullable: true })
  routerId: string;

  @Column({ name: 'nodo_id', nullable: true })
  nodoId: string;

  @Column({ name: 'onu_id', nullable: true })
  onuId: string;

  @Column({ name: 'segmento_id', nullable: true })
  segmentoId: string;

  @Column({ name: 'tecnico_instalacion', nullable: true })
  tecnicoInstalacionId: string;

  @Column({ name: 'vendedor_id', nullable: true })
  vendedorId: string;

  // ── Número de contrato ────────────────────────────────────
  @Column({ name: 'numero_contrato', length: 30 })
  numeroContrato: string;

  // ── Estado ────────────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: EstadoContrato,
    default: EstadoContrato.PENDIENTE_INSTALACION,
  })
  estado: EstadoContrato;

  @Column({ name: 'fecha_estado', type: 'timestamptz', default: () => 'NOW()' })
  fechaEstado: Date;

  @Column({ name: 'motivo_estado', type: 'text', nullable: true })
  motivoEstado: string;

  // ── Vigencia ──────────────────────────────────────────────
  @Column({ name: 'fecha_inicio', type: 'date' })
  fechaInicio: string;

  @Column({ name: 'fecha_vencimiento', type: 'date', nullable: true })
  fechaVencimiento: string;

  @Column({ name: 'fecha_instalacion', type: 'timestamptz', nullable: true })
  fechaInstalacion: Date;

  @Column({ name: 'fecha_baja', type: 'date', nullable: true })
  fechaBaja: string;

  @Column({ name: 'motivo_baja', type: 'text', nullable: true })
  motivoBaja: string;

  // ── Dirección de instalación ──────────────────────────────
  @Column({ name: 'direccion_instalacion', type: 'text', nullable: true })
  direccionInstalacion: string;

  @Column({ name: 'latitud_instalacion', type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitudInstalacion: number;

  @Column({ name: 'longitud_instalacion', type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitudInstalacion: number;

  // ── Red / PPPoE ───────────────────────────────────────────
  @Column({ name: 'usuario_pppoe', length: 100, nullable: true })
  usuarioPppoe: string;

  @Column({ name: 'password_pppoe', length: 500, nullable: true })
  passwordPppoe: string; // cifrado AES-256

  @Column({ name: 'ip_asignada', type: 'inet', nullable: true })
  ipAsignada: string;

  @Column({ name: 'mac_address', type: 'macaddr', nullable: true })
  macAddress: string;

  @Column({ name: 'vlan_id', type: 'smallint', nullable: true })
  vlanId: number;

  @Column({ name: 'nombre_queue', length: 100, nullable: true })
  nombreQueue: string;

  // ── Precio ────────────────────────────────────────────────
  @Column({ name: 'precio_mensual', type: 'decimal', precision: 10, scale: 2 })
  precioMensual: number;

  @Column({ name: 'descuento_pct', type: 'decimal', precision: 5, scale: 2, default: 0 })
  descuentoPct: number;

  @Column({ name: 'descuento_motivo', length: 200, nullable: true })
  descuentoMotivo: string;

  // precio_final es columna generada en BD, TypeORM solo lee
  @Column({ name: 'precio_final', type: 'decimal', precision: 10, scale: 2, insert: false, update: false, nullable: true })
  precioFinal: number;

  // ── Prórrogas ─────────────────────────────────────────────
  @Column({ name: 'en_prorroga', default: false })
  enProrroga: boolean;

  @Column({ name: 'prorroga_hasta', type: 'date', nullable: true })
  prorrogaHasta: string;

  @Column({ name: 'prorroga_motivo', type: 'text', nullable: true })
  prorrogaMotivo: string;

  @Column({ name: 'prorroga_otorgada_por', nullable: true })
  prorrogaOtorgadaPor: string;

  // ── Facturación ───────────────────────────────────────────
  @Column({ name: 'dia_facturacion', type: 'smallint', nullable: true })
  diaFacturacion: number;

  @Column({ name: 'fecha_ultimo_pago', type: 'date', nullable: true })
  fechaUltimoPago: string;

  @Column({ name: 'deuda_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  deudaTotal: number;

  @Column({ name: 'meses_deuda', type: 'smallint', default: 0 })
  mesesDeuda: number;

  // ── Aprovisionamiento FTTH ────────────────────────────────
  @Column({ default: false })
  aprovisionado: boolean;

  @Column({ name: 'aprovisionado_en', type: 'timestamptz', nullable: true })
  aprovisionadoEn: Date;

  // ── Red — campos adicionales ──────────────────────────────
  @Column({ name: 'excluir_firewall', default: false })
  excluirFirewall: boolean;

  @Column({ name: 'routes', type: 'text', nullable: true })
  routes: string;

  @Column({ name: 'ip_administracion', length: 45, nullable: true })
  ipAdministracion: string;

  @Column({ name: 'tipo_antena', length: 50, nullable: true })
  tipoAntena: string;

  @Column({ name: 'caja_nap', length: 100, nullable: true })
  cajaNap: string;

  @Column({ name: 'puerto_nap', length: 50, nullable: true })
  puertoNap: string;

  // ── Notas ─────────────────────────────────────────────────
  @Column({ name: 'notas_instalacion', type: 'text', nullable: true })
  notasInstalacion: string;

  @Column({ name: 'notas_tecnicas', type: 'text', nullable: true })
  notasTecnicas: string;

  @Column({ name: 'notas_admin', type: 'text', nullable: true })
  notasAdmin: string;

  // ── Auditoría ─────────────────────────────────────────────
  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  // ── Relaciones ────────────────────────────────────────────
  @OneToMany(() => ContratoHistorial, (h) => h.contrato)
  historial: ContratoHistorial[];

  // ── Helpers ───────────────────────────────────────────────
  get estaActivo(): boolean {
    return [EstadoContrato.ACTIVO, EstadoContrato.PRORROGA].includes(this.estado);
  }

  get estaSuspendido(): boolean {
    return [EstadoContrato.SUSPENDIDO_MORA, EstadoContrato.SUSPENDIDO_MANUAL].includes(this.estado);
  }

  get tieneMora(): boolean {
    return this.deudaTotal > 0;
  }

  get precioConDescuento(): number {
    if (!this.precioFinal) {
      return Number(this.precioMensual) * (1 - Number(this.descuentoPct || 0) / 100);
    }
    return Number(this.precioFinal);
  }
}

// ─── Historial de estados del contrato ───────────────────────
@Entity('contratos_historial')
@Index(['contratoId', 'createdAt'])
export class ContratoHistorial {
  @Column({ type: 'bigint', primary: true, generated: 'increment' })
  id: string;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({
    name: 'estado_anterior',
    type: 'enum',
    enum: EstadoContrato,
    nullable: true,
  })
  estadoAnterior: EstadoContrato;

  @Column({ name: 'estado_nuevo', type: 'enum', enum: EstadoContrato })
  estadoNuevo: EstadoContrato;

  @Column({ type: 'text', nullable: true })
  motivo: string;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId: string;

  @Column({ default: false })
  automatico: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @ManyToOne(() => Contrato, (c) => c.historial)
  @JoinColumn({ name: 'contrato_id' })
  contrato: Contrato;
}
