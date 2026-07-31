import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Salida de splitter ─────────────────────────────────────────
// Tabla: pe_splitter_salida
//
// Una fila por salida, creadas en la MISMA transacción que el splitter. Un splitter
// sin salidas es un registro corrupto que ninguna lógica posterior puede reparar sola.
//
// Cada salida alimenta O un hilo (cascada hacia otra mufa) O un puerto de NAP. El
// vínculo con el puerto vive en UN SOLO lado — `pe_nap_puerto.splitter_salida_id` — y
// no aquí. Guardarlo en ambos obliga a mantener dos verdades sincronizadas, y tarde o
// temprano divergen sin que nadie sepa cuál creer.
@Entity('pe_splitter_salida')
@Index('idx_pe_salida_splitter', ['splitterId'], { where: '"deleted_at" IS NULL' })
export class PeSplitterSalida extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'splitter_id', type: 'uuid' })
  splitterId: string;

  @Column({ type: 'int' })
  numero: number;

  /** No nulo sólo en cascadas: la salida sigue por fibra hacia otro nodo. */
  @Column({ name: 'hilo_salida_id', type: 'uuid', nullable: true })
  hiloSalidaId: string | null;
}
