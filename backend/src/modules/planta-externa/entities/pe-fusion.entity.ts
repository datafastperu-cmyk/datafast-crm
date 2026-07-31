import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

/** Pérdida típica de un empalme por fusión, en dB. Default del formulario. */
export const PERDIDA_FUSION_DB = 0.1;

// ─── Fusión de empalme ──────────────────────────────────────────
// Tabla: pe_fusion — la matriz de empalme dentro de una mufa.
//
// El invariante "un hilo se fusiona UNA sola vez" se impone con dos índices únicos
// parciales en la BD (`uq_pe_fusion_hilo_a`, `uq_pe_fusion_hilo_b`), no con un guard
// de servicio. Un guard que consulta y después inserta no sobrevive a dos requests
// concurrentes: ambos leen "libre" y ambos insertan. Es el mismo error que cometía el
// expediente al deducir puertos libres contando clientes.
@Entity('pe_fusion')
@Index('idx_pe_fusion_mufa', ['mufaId'], { where: '"deleted_at" IS NULL' })
export class PeFusion extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'mufa_id', type: 'uuid' })
  mufaId: string;

  @Column({ name: 'hilo_a_id', type: 'uuid' })
  hiloAId: string;

  @Column({ name: 'hilo_b_id', type: 'uuid' })
  hiloBId: string;

  @Column({ name: 'perdida_db', type: 'numeric', precision: 4, scale: 2, default: PERDIDA_FUSION_DB })
  perdidaDb: number;

  @Column({ type: 'text', nullable: true })
  observacion: string | null;
}
