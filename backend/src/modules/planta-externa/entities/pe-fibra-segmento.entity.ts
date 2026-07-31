import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { ElementoEstado } from '../domain/planta-externa-maquina-estados';

export enum SegmentoJerarquia {
  TRONCAL = 'troncal',
  SUBTRONCAL = 'subtroncal',
  DISTRIBUCION = 'distribucion',
}

export enum TipoInstalacion {
  AEREO = 'aereo',
  SUBTERRANEO = 'subterraneo',
  FACHADA = 'fachada',
}

/** Capacidades de cable admitidas. Fuera de esta lista es un error de tipeo. */
export const HILOS_VALIDOS = [2, 4, 6, 8, 12, 24, 48, 96, 144, 288] as const;

// ─── Segmento de fibra óptica ───────────────────────────────────
// Tabla: pe_fibra_segmento — la ARISTA del grafo óptico.
//
// Los extremos no usan FK polimórfica (una columna `tipo` + una `id` suelta): eso
// destruye la integridad referencial, porque Postgres no puede validar a qué apunta
// la fila. Se usan tres columnas por extremo con un CHECK de exclusividad, así la BD
// garantiza la integridad y el planner puede usar los índices.
@Entity('pe_fibra_segmento')
@Index('idx_pe_segmento_origen', ['origenMufaId', 'origenNapId', 'origenSiteId'], { where: '"deleted_at" IS NULL' })
export class PeFibraSegmento extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ type: 'varchar', length: 50 })
  codigo: string;

  @Column({ type: 'varchar', length: 20 })
  jerarquia: SegmentoJerarquia;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ name: 'hilos_totales', type: 'int' })
  hilosTotales: number;

  @Column({ name: 'tipo_instalacion', type: 'varchar', length: 20, default: TipoInstalacion.AEREO })
  tipoInstalacion: TipoInstalacion;

  // longitud_m y atenuacion_db_km existen para el presupuesto óptico (Fase 3). Sin
  // ellas el módulo sería sólo documental: son la diferencia entre dibujar la red y
  // poder decir "este cliente ve -27 dBm y debería ver -22, hay algo mal".
  @Column({ name: 'longitud_m', type: 'numeric', precision: 10, scale: 2 })
  longitudM: number;

  @Column({ name: 'atenuacion_db_km', type: 'numeric', precision: 4, scale: 3, default: 0.35 })
  atenuacionDbKm: number;

  // ── Extremos: exactamente uno de cada terna (CHECK en la BD) ──
  @Column({ name: 'origen_site_id', type: 'uuid', nullable: true })
  origenSiteId: string | null;

  @Column({ name: 'origen_mufa_id', type: 'uuid', nullable: true })
  origenMufaId: string | null;

  @Column({ name: 'origen_nap_id', type: 'uuid', nullable: true })
  origenNapId: string | null;

  @Column({ name: 'destino_site_id', type: 'uuid', nullable: true })
  destinoSiteId: string | null;

  @Column({ name: 'destino_mufa_id', type: 'uuid', nullable: true })
  destinoMufaId: string | null;

  @Column({ name: 'destino_nap_id', type: 'uuid', nullable: true })
  destinoNapId: string | null;

  // Polilínea del trazado (capa 2 del visor). JSONB y no tabla de vértices: la ruta
  // se lee y se escribe siempre completa, nunca por punto.
  @Column({ name: 'ruta_geojson', type: 'jsonb', nullable: true })
  rutaGeojson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: ElementoEstado.PLANIFICADO })
  estado: ElementoEstado;
}
