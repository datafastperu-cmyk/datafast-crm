import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { ElementoEstado } from '../domain/planta-externa-maquina-estados';

/** Adaptadores físicos que trae la caja. No es la capacidad de sus splitters. */
export const CAPACIDADES_NAP = [8, 16, 24, 32] as const;

// ─── Caja NAP ───────────────────────────────────────────────────
// Tabla: pe_nap
@Entity('pe_nap')
@Index('idx_pe_nap_bbox', ['empresaId', 'latitud', 'longitud'], { where: '"deleted_at" IS NULL' })
export class PeNap extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ type: 'varchar', length: 50 })
  codigo: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  direccion: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitud: number;

  @Column({ name: 'precision_gps_m', type: 'int', nullable: true })
  precisionGpsM: number | null;

  @Column({ name: 'mufa_origen_id', type: 'uuid', nullable: true })
  mufaOrigenId: string | null;

  @Column({ name: 'segmento_alimentador_id', type: 'uuid', nullable: true })
  segmentoAlimentadorId: string | null;

  /**
   * Cantidad de adaptadores FÍSICOS de la caja. Es independiente de la capacidad de
   * sus splitters: una NAP de 16 con un solo 1x8 tiene 8 puertos que se ven y se
   * tocan pero no dan servicio, hasta que se instala el segundo splitter alimentado
   * por un hilo de paso. El expediente fusionaba ambos conceptos con una relación fija
   * por caja, y con eso el planificador ve capacidad donde no puede conectar a nadie.
   */
  @Column({ name: 'capacidad_puertos', type: 'int', default: 8 })
  capacidadPuertos: number;

  /**
   * Contadores denormalizados: CACHÉ DE LECTURA para el semáforo del visor.
   * La fuente de verdad es siempre `pe_nap_puerto`; los mantiene un trigger que
   * recalcula por NAP (no aplica deltas, que es como un contador acaba mintiendo).
   *
   * Son dos y no uno porque responden preguntas de negocio distintas:
   * "¿puedo conectar un cliente hoy?" vs "¿esta caja necesita inversión en un splitter?".
   */
  @Column({ name: 'puertos_libres', type: 'int', default: 0 })
  puertosLibres: number;

  @Column({ name: 'puertos_no_habilitados', type: 'int', default: 0 })
  puertosNoHabilitados: number;

  @Column({ type: 'varchar', length: 20, default: ElementoEstado.PLANIFICADO })
  estado: ElementoEstado;
}
