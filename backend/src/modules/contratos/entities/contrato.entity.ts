import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { TipoServicioContrato } from '../../../common/constants/service-types';

// ─── Enums ────────────────────────────────────────────────────
export enum TipoPago {
  PREPAGO  = 'prepago',
  POSTPAGO = 'postpago',
}

export enum EstadoContrato {
  PENDIENTE_ACTIVACION = 'pendiente_activacion',
  ACTIVO                = 'activo',
  SUSPENDIDO            = 'suspendido',
  MOROSO                = 'moroso',    // deuda activa, aún con servicio (dentro de prorroga)
  CORTADO               = 'cortado',   // sin servicio, deuda vencida (post-prorroga)
  BAJA_DEFINITIVA       = 'baja_definitiva',
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

  @Column({ name: 'antena_ap_id', nullable: true })
  antenaApId: string;

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
    default: EstadoContrato.PENDIENTE_ACTIVACION,
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

  @Column({ name: 'tipo_auth', length: 20, nullable: true })
  tipoAuth: string;

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

  // Días de gracia antes del corte automático por mora
  @Column({ name: 'dias_prorroga', type: 'smallint', default: 3 })
  diasProrroga: number;

  // Días antes del vencimiento para enviar recordatorios (override de plantilla)
  @Column({ name: 'dias_recordatorio_1', type: 'smallint', nullable: true })
  diasRecordatorio1: number;

  @Column({ name: 'dias_recordatorio_2', type: 'smallint', nullable: true })
  diasRecordatorio2: number;

  @Column({ name: 'dias_recordatorio_3', type: 'smallint', nullable: true })
  diasRecordatorio3: number;

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
  @Column({ name: 'tipo_pago', type: 'enum', enum: TipoPago, nullable: true })
  tipoPago: TipoPago;

  // 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'
  @Column({ name: 'ciclo_facturacion', length: 20, nullable: true })
  cicloFacturacion: string;

  // 'fijo' | 'variable' — cómo se determina la fecha de cobro dentro del ciclo
  @Column({ name: 'ciclo_pago', length: 20, nullable: true })
  cicloPago: string;

  @Column({ name: 'dia_facturacion', type: 'smallint', nullable: true })
  diaFacturacion: number;

  @Column({ name: 'fecha_ultimo_pago', type: 'date', nullable: true })
  fechaUltimoPago: string;

  @Column({ name: 'deuda_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  deudaTotal: number;

  @Column({ name: 'meses_deuda', type: 'smallint', default: 0 })
  mesesDeuda: number;

  // ── Tipo de servicio ──────────────────────────────────────
  @Column({
    name: 'tipo_servicio',
    type: 'enum',
    enum: TipoServicioContrato,
    enumName: 'tipo_servicio',   // referencia el enum PG existente
    default: TipoServicioContrato.WISP,
  })
  tipoServicio: TipoServicioContrato;

  // ── Aprovisionamiento FTTH ────────────────────────────────
  @Column({ default: false })
  aprovisionado: boolean;

  @Column({ name: 'aprovisionado_en', type: 'timestamptz', nullable: true })
  aprovisionadoEn: Date;

  // ── Verificación post-provisioning (verify-after-write) ───
  // True si la última verificación confirmó que el hardware tiene
  // la configuración esperada. El reconciliador lo resetea si detecta divergencia.
  @Column({ name: 'hardware_verificado', default: false })
  hardwareVerificado: boolean;

  @Column({ name: 'hardware_verificado_en', type: 'timestamptz', nullable: true })
  hardwareVerificadoEn: Date;

  @Column({ name: 'hardware_estado', length: 30, nullable: true, default: 'desconocido' })
  hardwareEstado: string; // 'ok' | 'inconsistente' | 'desconocido' | 'sin_hardware'

  // ── Red — campos adicionales ──────────────────────────────
  @Column({ name: 'excluir_firewall', default: false })
  excluirFirewall: boolean;

  @Column({ name: 'routes', type: 'text', nullable: true })
  routes: string;

  @Column({ name: 'ip_administracion', length: 45, nullable: true })
  ipAdministracion: string;

  @Column({ name: 'tipo_antena', length: 50, nullable: true })
  tipoAntena: string;

  @Column({ name: 'tipo_ipv4', length: 20, default: 'estatica', nullable: true })
  tipoIpv4: string;

  @Column({ name: 'descripcion_servicio', type: 'text', nullable: true })
  descripcionServicio: string;

  @Column({ name: 'comunidad_snmp', length: 100, nullable: true })
  comunidadSnmp: string;

  @Column({ name: 'usuario_antena', length: 100, nullable: true })
  usuarioAntena: string;

  @Column({ name: 'contrasena_antena', length: 500, nullable: true })
  contrasenaAntena: string;

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
    return this.estado === EstadoContrato.ACTIVO;
  }

  get estaSuspendido(): boolean {
    return this.estado === EstadoContrato.SUSPENDIDO;
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
