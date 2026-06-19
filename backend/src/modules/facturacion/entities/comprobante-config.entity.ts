import { Entity, Column, Index, Unique } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Tipos de item dentro de un comprobante ──────────────────
export type TipoItem = 'servicio' | 'reconexion' | 'mora';

// ─── Interfaz extendida de items con soporte de cargos ───────
export interface ItemFacturaExtendido {
  descripcion:       string;
  cantidad:          number;
  precioUnitario:    number;
  descuento?:        number;
  subtotal:          number;
  tipoItem?:         TipoItem;
  // null = heredar carga fiscal del comprobante padre
  // true/false = override explícito (mora siempre false, reconexión siempre true)
  aplicaIgvOverride?: boolean | null;
}

// ─── Tipo de comprobante configurado por empresa ──────────────
// Reemplaza el enum hardcodeado TipoComprobante.
// Cada empresa define sus propios tipos: Factura, Recibo, Comprobante Interno, etc.
@Entity('comprobantes_config')
@Index(['empresaId', 'activo'])
@Unique(['empresaId', 'codigo'])
export class ComprobanteConfig extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // Nombre visible: "Factura", "Recibo", "Comprobante Interno"
  @Column({ length: 100 })
  nombre: string;

  // Código interno único por empresa: 'fac', 'rec', 'ci'
  // Guardado en facturas.tipo_comprobante para trazabilidad
  @Column({ length: 30 })
  codigo: string;

  // Si aplica IGV/IVA al calcular el total del comprobante
  // Los items de tipo 'mora' siempre ignoran esto (sin IGV)
  // Los items de tipo 'reconexion' siempre aplican IGV
  @Column({ name: 'tiene_carga_fiscal', default: true })
  tieneCargaFiscal: boolean;

  // Serie de numeración: 'F001', 'R001', 'CI'
  @Column({ length: 10 })
  serie: string;

  // Correlativo actual — se incrementa atómicamente con UPDATE ... RETURNING
  // Nunca usar MAX()+1 para evitar race conditions
  @Column({ name: 'correlativo_actual', type: 'int', default: 0 })
  correlativoActual: number;

  // Si es el tipo que usa la empresa cuando el cliente no tiene config específica
  @Column({ name: 'es_default', default: false })
  esDefault: boolean;

  @Column({ default: true })
  activo: boolean;

  @Column({ name: 'creado_por', nullable: true })
  creadoPor: string;
}
