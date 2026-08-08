import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Motivos tipificados. De esto depende si el dinero se le devuelve al abonado. */
export type MotivoExtorno =
  | 'error_registro'
  | 'devolucion_cliente'
  | 'cheque_rebotado'
  | 'contracargo'
  | 'pago_duplicado'
  | 'fraude';

/**
 * Anulación de un pago ya registrado.
 *
 * El motivo es **tipificado y no texto libre** porque de él dependen dos cosas distintas: si
 * hay que devolver dinero y si el servicio del abonado puede cortarse. `error_registro` —el
 * caso más frecuente— significa que la equivocación fue **nuestra**, y cortarle el servicio
 * a alguien por un error propio es de los fallos que no se olvidan.
 *
 * `monto_revertido` y `facturas_afectadas` se guardan aquí, y no se deducen del pago: la
 * fila del pago sigue existiendo pero cambia de estado. Sin esta copia, dentro de un año
 * nadie puede reconstruir **qué se deshizo exactamente**.
 *
 * `estaba_conciliado` registra que el extorno rompió un cierre contable ya cerrado. No lo
 * impide —a veces hay que hacerlo— pero deja constancia para que salte en la revisión.
 *
 * Entidad para que el compilador vigile las columnas (R7 / B-2). Tabla de **dinero**.
 */
@Entity('pago_extorno')
@Index(['empresaId', 'pagoId'])
export class PagoExtorno {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'pago_id', type: 'uuid' })
  pagoId: string;

  @Column({ name: 'motivo', type: 'varchar', length: 30 })
  motivo: MotivoExtorno;

  @Column({ name: 'nota', type: 'text', nullable: true })
  nota: string | null;

  /** Lo que el pago valía antes de anularse. */
  @Column({ name: 'monto_revertido', type: 'numeric', precision: 12, scale: 2 })
  montoRevertido: string;

  /** Qué comprobantes quedaron descuadrados y por cuánto. */
  @Column({ name: 'facturas_afectadas', type: 'jsonb', default: () => `'[]'::jsonb` })
  facturasAfectadas: Array<Record<string, unknown>>;

  @Column({ name: 'estaba_conciliado', type: 'boolean', default: false })
  estabaConciliado: boolean;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'usuario_email', type: 'varchar', length: 200, nullable: true })
  usuarioEmail: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
