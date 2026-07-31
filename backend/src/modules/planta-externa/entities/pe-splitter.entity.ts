import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { ElementoEstado } from '../domain/planta-externa-maquina-estados';

export enum SplitterRelacion {
  R1X2 = '1x2',
  R1X4 = '1x4',
  R1X8 = '1x8',
  R1X16 = '1x16',
  R1X32 = '1x32',
}

/** Salidas por relación. Fuente única: derivarlo con un `split('x')` a mano en cada sitio es cómo se cuela un off-by-one. */
export const SALIDAS_POR_RELACION: Record<SplitterRelacion, number> = {
  [SplitterRelacion.R1X2]: 2,
  [SplitterRelacion.R1X4]: 4,
  [SplitterRelacion.R1X8]: 8,
  [SplitterRelacion.R1X16]: 16,
  [SplitterRelacion.R1X32]: 32,
};

/**
 * Pérdida por inserción típica, en dB. Es sólo el DEFAULT del formulario: el valor real
 * se persiste por splitter porque varía por fabricante y generación (un 1x8 puede ser
 * 10.2 o 10.8 dB). Derivarla siempre de esta tabla haría que el presupuesto óptico
 * arrastre un error sistemático que nadie puede corregir sin tocar código.
 */
export const PERDIDA_TIPICA_DB: Record<SplitterRelacion, number> = {
  [SplitterRelacion.R1X2]: 3.6,
  [SplitterRelacion.R1X4]: 7.2,
  [SplitterRelacion.R1X8]: 10.5,
  [SplitterRelacion.R1X16]: 13.5,
  [SplitterRelacion.R1X32]: 16.8,
};

// ─── Splitter óptico ────────────────────────────────────────────
// Tabla: pe_splitter
//
// Entidad propia, NO un atributo de la NAP como proponía el expediente. Un splitter
// tiene 1 entrada y N salidas, y puede vivir en una mufa o en una NAP. Modelarlo como
// columna de la caja impide dos cosas que en planta real ocurren todo el tiempo:
// cascadas 1x2 → 1x8, y más de un splitter en la misma caja.
@Entity('pe_splitter')
@Index('idx_pe_splitter_alojamiento', ['alojadoEnMufaId', 'alojadoEnNapId'], { where: '"deleted_at" IS NULL' })
export class PeSplitter extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  codigo: string | null;

  @Column({ type: 'varchar', length: 10 })
  relacion: SplitterRelacion;

  @Column({ name: 'perdida_db', type: 'numeric', precision: 4, scale: 2 })
  perdidaDb: number;

  // Alojamiento: exactamente uno (CHECK en la BD). Confirmado con operaciones que NO
  // existen splitters sin contenedor, así que dos opciones bastan.
  @Column({ name: 'alojado_en_mufa_id', type: 'uuid', nullable: true })
  alojadoEnMufaId: string | null;

  @Column({ name: 'alojado_en_nap_id', type: 'uuid', nullable: true })
  alojadoEnNapId: string | null;

  // Hilo que lo alimenta. En el segundo splitter de una caja suele ser un hilo DE PASO
  // del cable que la cruza, no del alimentador original: por eso no se restringe al
  // segmento alimentador de la NAP.
  @Column({ name: 'hilo_entrada_id', type: 'uuid', nullable: true })
  hiloEntradaId: string | null;

  @Column({ type: 'varchar', length: 20, default: ElementoEstado.PLANIFICADO })
  estado: ElementoEstado;
}
