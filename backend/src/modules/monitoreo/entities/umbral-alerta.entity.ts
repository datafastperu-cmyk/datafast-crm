// Ruta: /opt/datafast/backend/src/modules/monitoreo/entities/umbral-alerta.entity.ts
//
// Lógica de prioridad de umbrales (evaluada en el worker de monitoreo):
//   1. Umbral específico de dispositivo   (dispositivo_id NOT NULL)  — mayor prioridad
//   2. Umbral global por tipo de equipo   (tipo_equipo NOT NULL, dispositivo_id NULL)
//   3. Umbral global de empresa           (ambos campos NULL)        — menor prioridad
//
// CHECK de integridad (incluido en la migración SQL):
//   dispositivo_id IS NOT NULL OR tipo_equipo IS NOT NULL OR empresa_id IS NOT NULL

import {
  Column, CreateDateColumn, DeleteDateColumn,
  Entity, Index, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { TipoEquipo } from '../enums/monitoreo.enums';
import { DispositivoMonitoreo } from './dispositivo-monitoreo.entity';

@Entity('umbrales_alerta')
@Index('idx_umbral_dispositivo', ['dispositivoId'])
@Index('idx_umbral_empresa',     ['empresaId'])
export class UmbralAlerta {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Alcance del umbral (al menos uno debe ser NOT NULL) ───────
  @Column({ name: 'dispositivo_id', nullable: true })
  dispositivoId: string | null;

  @ManyToOne(() => DispositivoMonitoreo, { nullable: true, onDelete: 'CASCADE' })
  dispositivo: DispositivoMonitoreo | null;

  // Si dispositivo_id es NULL, aplica a todos los dispositivos de este tipo
  @Column({
    name:     'tipo_equipo',
    type:     'enum',
    enum:     TipoEquipo,
    nullable: true,
  })
  tipoEquipo: TipoEquipo | null;

  // Nombre descriptivo (ej: "Crítico AP centro", "Global MikroTik")
  @Column({ name: 'nombre', length: 100, nullable: true })
  nombre: string | null;

  // ── Umbrales de red ───────────────────────────────────────────
  // Latencia ICMP máxima permitida (ms). NULL = sin límite.
  @Column({ name: 'latencia_max_ms', type: 'int', nullable: true })
  latenciaMaxMs: number | null;

  // Pérdida de paquetes máxima (%). NULL = sin límite.
  @Column({ name: 'loss_max_pct', type: 'smallint', nullable: true })
  lossMaxPct: number | null;

  // ── Umbrales de sistema ───────────────────────────────────────
  @Column({ name: 'cpu_max_pct', type: 'smallint', nullable: true })
  cpuMaxPct: number | null;

  @Column({ name: 'memory_max_pct', type: 'smallint', nullable: true })
  memoryMaxPct: number | null;

  // ── Umbrales de tráfico (bps) ─────────────────────────────────
  @Column({ name: 'traffic_down_max_bps', type: 'bigint', nullable: true })
  trafficDownMaxBps: string | null;

  @Column({ name: 'traffic_up_max_bps', type: 'bigint', nullable: true })
  trafficUpMaxBps: string | null;

  // ── Comportamiento ante alerta ────────────────────────────────
  // Nivel que genera la alerta al superar estos umbrales
  @Column({ name: 'nivel_alerta', length: 20, default: 'WARNING' })
  nivelAlerta: string; // 'WARNING' | 'CRITICA'

  // Cuántas mediciones consecutivas deben superar el umbral antes de alertar.
  // Evita falsos positivos por picos breves.
  @Column({ name: 'confirmaciones_requeridas', type: 'smallint', default: 3 })
  confirmacionesRequeridas: number;

  // ── Auditoría ─────────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
