import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { ItemFacturaExtendido } from './comprobante-config.entity';

// ─── Estados de factura ───────────────────────────────────────
export enum EstadoFactura {
  BORRADOR       = 'borrador',
  EMITIDA        = 'emitida',
  PAGADA         = 'pagada',
  PAGADA_PARCIAL = 'pagada_parcial',
  VENCIDA        = 'vencida',
  ANULADA        = 'anulada',
  EN_COBRANZA    = 'en_cobranza',
}

// Re-export para compatibilidad con código existente
export type ItemFactura = ItemFacturaExtendido;

// ─── Entidad principal ────────────────────────────────────────
@Entity('facturas')
@Index(['empresaId', 'estado', 'fechaVencimiento'])
@Index(['empresaId', 'clienteId', 'fechaEmision'])
@Index(['empresaId', 'fechaEmision'])
@Index(['contratoId'])
@Index(['comprobanteConfigId'])
export class Factura extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ name: 'contrato_id', nullable: true })
  contratoId: string;

  // ── Tipo de comprobante ────────────────────────────────────
  // FK al código del ComprobantesConfig activo al momento de emitir.
  // Guardado como varchar (snapshot del código) para no perder
  // trazabilidad si el tipo se renombra después.
  @Column({ name: 'comprobante_config_id', nullable: true })
  comprobanteConfigId: string;

  // Snapshot del código para reportes y filtros rápidos sin JOIN
  @Column({ name: 'tipo_comprobante', length: 30 })
  tipoComprobante: string;

  // Snapshot del nombre legible al momento de emisión
  @Column({ name: 'tipo_comprobante_nombre', length: 100, nullable: true })
  tipoComprobanteNombre: string;

  // Snapshot: si tenía carga fiscal al emitir
  @Column({ name: 'tiene_carga_fiscal', default: true })
  tieneCargaFiscal: boolean;

  @Column({ length: 10 })
  serie: string;

  @Column({ type: 'int' })
  correlativo: number;

  // numero_completo es columna generada en BD (serie || '-' || correlativo)
  @Column({ name: 'numero_completo', insert: false, update: false, nullable: true })
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

  @Column({
    name: 'base_imponible',
    type: 'decimal', precision: 12, scale: 2,
    insert: false, update: false, nullable: true,
  })
  baseImponible: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  igv: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;

  @Column({ name: 'monto_pagado', type: 'decimal', precision: 12, scale: 2, default: 0 })
  montoPagado: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, insert: false, update: false, nullable: true })
  saldo: number;

  // ── Moneda (snapshot de la config al momento de emisión) ─
  @Column({ length: 10, default: 'PEN' })
  moneda: string;

  @Column({ name: 'tipo_cambio', type: 'decimal', precision: 8, scale: 4, default: 1.0 })
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
  // Usa ItemFacturaExtendido: incluye tipoItem y aplicaIgvOverride
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

  // ── Flags ─────────────────────────────────────────────────
  @Column({ name: 'generada_automaticamente', default: false })
  generadaAutomaticamente: boolean;

  @Column({ name: 'enviada_por_email', default: false })
  enviadaPorEmail: boolean;

  @Column({ name: 'enviada_por_whatsapp', default: false })
  enviadaPorWhatsapp: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;
}
