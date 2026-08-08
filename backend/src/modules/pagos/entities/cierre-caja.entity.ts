import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Arqueo de caja: la foto de lo que el ERP decía que había frente a lo que se contó.
 *
 * `diferencia` está **derivada y persistida** a propósito, no calculada al leer: es el dato
 * que se audita. Un arqueo dice qué se creyó y qué se encontró **en aquel momento**; si la
 * diferencia se recalculara después, un ajuste posterior la haría desaparecer y el descuadre
 * dejaría de existir en los libros — que es justo lo contrario de para qué sirve un arqueo.
 *
 * Entidad para que el compilador vigile las columnas (R7 / B-2). Es una tabla de **dinero**:
 * un nombre de columna mal escrito dentro de un literal de plantilla no lo ve `tsc`, y aquí
 * el coste de descubrirlo tarde es un descuadre contable que nadie sabe explicar.
 */
@Entity('cierre_caja')
@Index(['empresaId', 'cuentaId', 'hasta'])
export class CierreCaja {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  cuentaId: string;

  @Column({ name: 'desde', type: 'date' })
  desde: string;

  @Column({ name: 'hasta', type: 'date' })
  hasta: string;

  /** Lo que el ERP decía que había cuando se cerró. */
  @Column({ name: 'esperado', type: 'numeric', precision: 12, scale: 2 })
  esperado: string;

  /** Lo que se contó de verdad. */
  @Column({ name: 'contado', type: 'numeric', precision: 12, scale: 2 })
  contado: string;

  /** `contado − esperado`, congelada en el momento del cierre. */
  @Column({ name: 'diferencia', type: 'numeric', precision: 12, scale: 2 })
  diferencia: string;

  /** Obligatoria cuando hay descuadre: un faltante sin explicación es lo que el arqueo existe para detectar. */
  @Column({ name: 'nota', type: 'text', nullable: true })
  nota: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  /** Se guarda el correo, no solo el id: dentro de un año el usuario puede no existir. */
  @Column({ name: 'usuario_email', type: 'varchar', length: 200, nullable: true })
  usuarioEmail: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
