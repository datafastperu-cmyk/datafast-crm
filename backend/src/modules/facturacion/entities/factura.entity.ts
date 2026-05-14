import { Entity, Column, Index, BeforeInsert } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Enums ────────────────────────────────────────────────────
export enum TipoComprobante {
  BOLETA         = 'boleta',
  FACTURA        = 'factura',
  NOTA_CREDITO   = 'nota_credito',
  NOTA_DEBITO    = 'nota_debito',
  RECIBO_INTERNO = 'recibo_interno',
}

export enum EstadoFactura {
  BORRADOR       = 'borrador',
  EMITIDA        = 'emitida',
  PAGADA         = 'pagada',
  PAGADA_PARCIAL = 'pagada_parcial',
  VENCIDA        = 'vencida',
  ANULADA        = 'anulada',
  EN_COBRANZA    = 'en_cobranza',
}

// ─── Item de factura (para facturas multi-concepto) ──────────
export interface ItemFactura {
  descripcion:    string;
  cantidad:       number;
  precioUnitario: number;
  descuento?:     number;   // monto de descuento por unidad
  subtotal:       number;   // cantidad * precioUnitario - descuento
}

// ─── Entidad principal ────────────────────────────────────────
@Entity('facturas')
@Index(['empresaId', 'estado', 'fechaVencimiento'])
@Index(['empresaId', 'clienteId', 'fechaEmision'])
@Index(['empresaId', 'fechaEmision'])
@Index(['contratoId'])
export class Factura extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ name: 'contrato_id', nullable: true })
  contratoId: string;

  // ── Numeración SUNAT ──────────────────────────────────────
  @Column({
    name: 'tipo_comprobante',
    type: 'enum',
    enum: TipoComprobante,
    default: TipoComprobante.BOLETA,
  })
  tipoComprobante: TipoComprobante;

  @Column({ length: 10 })
  serie: string;           // 'B001', 'F001'

  @Column({ type: 'int' })
  correlativo: number;     // 1, 2, 3...

  // numero_completo es columna generada en BD (serie || '-' || correlativo)
  @Column({
    name: 'numero_completo',
    insert: false,
    update: false,
    nullable: true,
  })
  numeroCompleto: string;

  // ── Periodo facturado ────────────────────────────────────
  @Column({ name: 'periodo_inicio', type: 'date' })
  periodoInicio: string;

  @Column({ name: 'periodo_fin', type: 'date' })
  periodoFin: string;

  @Column({ type: 'text', default: 'Servicio de internet' })
  descripcion: string;

  // ── Montos ───────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  descuento: number;

  // base_imponible = subtotal - descuento (columna generada en BD)
  @Column({
    name: 'base_imponible',
    type: 'decimal',
    precision: 12,
    scale: 2,
    insert: false,
    update: false,
    nullable: true,
  })
  baseImponible: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  igv: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;

  @Column({
    name: 'monto_pagado',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  montoPagado: number;

  // saldo = total - monto_pagado (columna generada en BD)
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    insert: false,
    update: false,
    nullable: true,
  })
  saldo: number;

  // ── Moneda ───────────────────────────────────────────────
  @Column({ length: 10, default: 'PEN' })
  moneda: string;

  @Column({
    name: 'tipo_cambio',
    type: 'decimal',
    precision: 8,
    scale: 4,
    default: 1.0,
  })
  tipoCambio: number;

  // ── Estado y fechas ──────────────────────────────────────
  @Column({ type: 'enum', enum: EstadoFactura, default: EstadoFactura.EMITIDA })
  estado: EstadoFactura;

  @Column({ name: 'fecha_emision', type: 'date', default: () => 'CURRENT_DATE' })
  fechaEmision: string;

  @Column({ name: 'fecha_vencimiento', type: 'date' })
  fechaVencimiento: string;

  @Column({ name: 'fecha_pago', type: 'date', nullable: true })
  fechaPago: string;

  // ── Items detallados (JSONB) ──────────────────────────────
  @Column({ type: 'jsonb', default: '[]' })
  items: ItemFactura[];

  // ── PDF ──────────────────────────────────────────────────
  @Column({ name: 'pdf_url', length: 500, nullable: true })
  pdfUrl: string;

  @Column({ name: 'pdf_generado_en', type: 'timestamptz', nullable: true })
  pdfGeneradoEn: Date;

  // ── SUNAT ────────────────────────────────────────────────
  @Column({ name: 'sunat_enviada', default: false })
  sunatEnviada: boolean;

  @Column({ name: 'sunat_aceptada', nullable: true })
  sunatAceptada: boolean;

  @Column({ name: 'sunat_codigo_hash', length: 200, nullable: true })
  sunatCodigoHash: string;

  @Column({ name: 'sunat_error', type: 'text', nullable: true })
  sunatError: string;

  @Column({ name: 'sunat_enviada_en', type: 'timestamptz', nullable: true })
  sunatEnviadaEn: Date;

  // ── Nota de crédito / anulación ──────────────────────────
  @Column({ name: 'factura_original_id', nullable: true })
  facturaOriginalId: string;

  @Column({ name: 'motivo_anulacion', type: 'text', nullable: true })
  motivoAnulacion: string;

  @Column({ name: 'anulada_en', type: 'timestamptz', nullable: true })
  anuladaEn: Date;

  @Column({ name: 'anulada_por', nullable: true })
  anuladaPor: string;

  // ── Flags de envío ────────────────────────────────────────
  @Column({ name: 'generada_automaticamente', default: false })
  generadaAutomaticamente: boolean;

  @Column({ name: 'enviada_por_email', default: false })
  enviadaPorEmail: boolean;

  @Column({ name: 'enviada_por_whatsapp', default: false })
  enviadaPorWhatsapp: boolean;

  // ── Auditoría ────────────────────────────────────────────
  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  // ── Helpers computados ───────────────────────────────────
  get estaVencida(): boolean {
    if (this.estado === EstadoFactura.PAGADA) return false;
    return new Date(this.fechaVencimiento) < new Date();
  }

  get esPagada(): boolean {
    return [EstadoFactura.PAGADA].includes(this.estado);
  }

  get saldoPendiente(): number {
    return Math.max(0, Number(this.total) - Number(this.montoPagado));
  }

  get diasVencida(): number {
    if (!this.estaVencida) return 0;
    const diff = Date.now() - new Date(this.fechaVencimiento).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }
}
