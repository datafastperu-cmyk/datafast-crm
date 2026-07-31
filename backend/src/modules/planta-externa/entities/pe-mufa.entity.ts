import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';
import { ElementoEstado } from '../domain/planta-externa-maquina-estados';

export enum MufaJerarquia {
  PRIMER_NIVEL = 'primer_nivel',
  SEGUNDO_NIVEL = 'segundo_nivel',
}

// ─── Mufa de empalme ────────────────────────────────────────────
// Tabla: pe_mufa
//
// Una mufa puede ser de fusión pura (continuidad), de derivación (varios segmentos
// terminan en ella y las fusiones reparten hilos entre ellos, sin división de
// potencia) o alojar splitters. Las tres son la misma tabla: lo que las diferencia
// es lo que cuelga de ellas, no un atributo declarado que alguien deba mantener al día.
//
// NOTA SWC: toda columna nullable lleva `type:` explícito. Sin él, `string | null`
// se compila a `Object`, que TypeORM no soporta, y el backend crashea en arranque
// en frío — no en compilación, que es lo que lo hace difícil de ver.
@Entity('pe_mufa')
@Index('idx_pe_mufa_bbox', ['empresaId', 'latitud', 'longitud'], { where: '"deleted_at" IS NULL' })
export class PeMufa extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ type: 'varchar', length: 50 })
  codigo: string;

  @Column({ type: 'varchar', length: 20, default: MufaJerarquia.PRIMER_NIVEL })
  jerarquia: MufaJerarquia;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  direccion: string | null;

  // Obligatorias: una mufa sin coordenada es una mufa que nadie encuentra, y
  // encontrarla es el motivo por el que existe este módulo.
  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitud: number;

  // Precisión reportada por el GPS, en metros. Un GPS con 2 km de error rellena el
  // formulario exactamente igual que uno bueno; sin este dato nadie se entera hasta
  // que un técnico va a buscar la mufa y no está.
  @Column({ name: 'precision_gps_m', type: 'int', nullable: true })
  precisionGpsM: number | null;

  @Column({ name: 'capacidad_fusiones', type: 'int', nullable: true })
  capacidadFusiones: number | null;

  @Column({ type: 'varchar', length: 20, default: ElementoEstado.PLANIFICADO })
  estado: ElementoEstado;
}
