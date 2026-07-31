import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum HiloEstado {
  LIBRE = 'libre',
  EN_USO = 'en_uso',
  AVERIADO = 'averiado',
  RESERVADO = 'reservado',
}

/**
 * Código de colores EIA-598, por posición dentro del buffer. Se usa para autocompletar
 * el color al crear los hilos de un segmento: el técnico en campo identifica el hilo
 * por color, no por número, y tipear 288 colores a mano garantiza errores.
 */
export const COLORES_EIA598 = [
  'azul', 'naranja', 'verde', 'marron', 'gris', 'blanco',
  'rojo', 'negro', 'amarillo', 'violeta', 'rosa', 'aguamarina',
] as const;

// ─── Hilo de fibra ──────────────────────────────────────────────
// Tabla: pe_fibra_hilo
//
// N filas por segmento, creadas en la MISMA transacción que el segmento. Sin esta
// tabla no existe trazabilidad ni continuidad: es la omisión principal del expediente
// original, que pedía "matriz de fusiones hilo X ↔ hilo Y" pero no declaraba dónde
// vive el hilo.
@Entity('pe_fibra_hilo')
@Index('idx_pe_hilo_segmento', ['segmentoId', 'estado'], { where: '"deleted_at" IS NULL' })
export class PeFibraHilo extends BaseModel {

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'segmento_id', type: 'uuid' })
  segmentoId: string;

  @Column({ type: 'int' })
  numero: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  color: string | null;

  @Column({ type: 'varchar', length: 20, default: HiloEstado.LIBRE })
  estado: HiloEstado;
}
