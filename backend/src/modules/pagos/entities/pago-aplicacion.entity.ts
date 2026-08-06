import {
  Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn,
} from 'typeorm';

/**
 * Imputación de un pago a un comprobante.
 *
 * Un pago consolidado salda varios comprobantes con un solo ingreso de dinero y un solo
 * número de operación; esta tabla dice cuánto de ese pago fue a cada factura. Para un pago
 * de una sola factura hay exactamente una fila, así que el histórico y el consolidado se
 * consultan igual.
 */
@Entity('pago_aplicaciones')
@Index(['pagoId', 'facturaId'], { unique: true })
export class PagoAplicacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'pago_id', type: 'uuid' })
  pagoId: string;

  @Column({ name: 'factura_id', type: 'uuid' })
  facturaId: string;

  @Column({
    name: 'monto_aplicado', type: 'numeric', precision: 12, scale: 2,
    transformer: {
      to:   (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : parseFloat(v)),
    },
  })
  montoAplicado: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /**
   * Cuándo esta imputación se volcó sobre la factura.
   *
   * La fila se crea al registrar el pago —es la DECLARACIÓN de qué cubre ese dinero—, pero
   * el efecto sobre el comprobante puede ocurrir después (un pago pendiente que un
   * supervisor verifica días más tarde). Separarlos es lo que hace la aplicación
   * idempotente: reintentar solo toca las filas con esto en NULL.
   *
   * Sin esta columna, reintentar era indistinguible de aplicar por primera vez, y el
   * reconciliador reintentaba en bucle pagos ya aplicados (F0, 2026-08-06: 1123 pasadas).
   */
  @Column({ name: 'aplicado_en', type: 'timestamptz', nullable: true })
  aplicadoEn: Date | null;
}
