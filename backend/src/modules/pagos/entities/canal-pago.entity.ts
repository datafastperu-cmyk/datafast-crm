import { Entity, Column, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Taxonomía CERRADA de formas de pago.
 *
 * No es configurable por el operador a propósito: es el eje de los reportes contables y
 * de la conciliación, así que cambiarla cambia el significado del histórico. Lo que el
 * negocio sí configura son los canales.
 */
export enum FormaPago {
  EFECTIVO      = 'efectivo',
  TRANSFERENCIA = 'transferencia',
  DEPOSITO      = 'deposito',
  BILLETERA     = 'billetera',
  TARJETA       = 'tarjeta',
  PASARELA      = 'pasarela',
  /** No es un ingreso de caja, pero salda un comprobante. */
  NOTA_CREDITO  = 'nota_credito',
  OTRO          = 'otro',
}

/**
 * El medio concreto por el que entró el dinero: Yape, BCP, la oficina, el POS.
 *
 * Es el nivel que faltaba. `metodo_pago` mezclaba los dos: `yape` (un canal) convivía en
 * el mismo enum con `transferencia_bancaria` (una forma). Al ser texto libre, además,
 * cualquier cosa cabía — el diagnóstico F0 encontró `'Efectivo'` capitalizado, que no era
 * ningún valor del dominio, y un pago en efectivo con `banco = 'Banco 01'`.
 *
 * La cuenta receptora por defecto vive AQUÍ y no en una tabla de reglas aparte: una tabla
 * 1:1 con canales es una tabla de canales con pasos extra.
 */
@Entity('canal_pago')
@Index(['empresaId', 'codigo'], { unique: true })
export class CanalPago {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  /**
   * Clave de negocio INMUTABLE. El nombre es un rótulo y puede cambiar mañana; el código
   * es lo que resuelve un pago entrante y lo que referencia el histórico.
   */
  @Column({ type: 'varchar', length: 40 })
  codigo: string;

  @Column({ type: 'varchar', length: 80 })
  nombre: string;

  @Column({ name: 'forma_pago', type: 'varchar', length: 30 })
  formaPago: FormaPago;

  /** Nullable a propósito: sin cuenta fija, la elige el operador. Mejor que inventarla. */
  @Column({ name: 'cuenta_receptora_default_id', type: 'uuid', nullable: true })
  cuentaReceptoraDefaultId: string | null;

  @Column({ name: 'requiere_numero_operacion', type: 'boolean', default: false })
  requiereNumeroOperacion: boolean;

  @Column({ name: 'requiere_voucher', type: 'boolean', default: false })
  requiereVoucher: boolean;

  /**
   * Lo que retiene el canal. NO se descuenta de lo que salda la factura: el abonado pagó
   * el bruto. Saldar con el neto dejaría debiendo la comisión a quien pagó completo, y el
   * ERP lo cortaría por moroso.
   */
  @Column({ name: 'comision_porcentaje', type: 'numeric', precision: 6, scale: 4, default: 0,
            transformer: { to: (v: number) => v, from: (v: string | null) => (v === null ? 0 : parseFloat(v)) } })
  comisionPorcentaje: number;

  @Column({ name: 'comision_fija', type: 'numeric', precision: 12, scale: 2, default: 0,
            transformer: { to: (v: number) => v, from: (v: string | null) => (v === null ? 0 : parseFloat(v)) } })
  comisionFija: number;

  /** `false` para canales que solo crea una pasarela: no se ofrecen en la caja manual. */
  @Column({ name: 'permite_registro_manual', type: 'boolean', default: true })
  permiteRegistroManual: boolean;

  /**
   * Baja LÓGICA. Desactivar retira el canal de los selectores, jamás del histórico: un
   * pago de hace dos años tiene que seguir diciendo por dónde entró.
   */
  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'es_protegido', type: 'boolean', default: false })
  esProtegido: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;
}
