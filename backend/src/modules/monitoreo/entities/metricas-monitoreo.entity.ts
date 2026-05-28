// Ruta: /opt/datafast/backend/src/modules/monitoreo/entities/metricas-monitoreo.entity.ts
//
// NOTA DE ARQUITECTURA:
// Esta tabla crece muy rápido (1 fila por dispositivo por ciclo de chequeo).
// Con 50 dispositivos cada 60 s → ~3.000 filas/hora → ~72.000/día → ~2.2M/mes.
// Se recomienda activar TimescaleDB o particionado nativo por rango de tiempo:
//   CREATE TABLE metricas_monitoreo (...) PARTITION BY RANGE (timestamp);
// Ver el bloque de SQL al final del fichero de migración.

import {
  Column, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

// TypeORM no exporta BigIntColumn — usamos Column con type: 'bigint'
import { DispositivoMonitoreo } from './dispositivo-monitoreo.entity';

@Entity('metricas_monitoreo')
// Índice compuesto: consultas del tipo "últimas N métricas del dispositivo X"
@Index('idx_metricas_disp_ts', ['dispositivoId', 'timestamp'])
export class MetricasMonitoreo {

  // BIGSERIAL es más eficiente que UUID para inserciones masivas en time-series.
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string; // TypeORM lo devuelve como string cuando es bigint

  // ── Dispositivo ───────────────────────────────────────────────
  @Column({ name: 'dispositivo_id' })
  dispositivoId: string;

  @ManyToOne(() => DispositivoMonitoreo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispositivo_id' })
  dispositivo: DispositivoMonitoreo;

  // ── Red ───────────────────────────────────────────────────────
  // Latencia ICMP en milisegundos
  @Column({ name: 'ping_latencia_ms', type: 'int', nullable: true })
  pingLatenciaMs: number | null;

  // Pérdida de paquetes en porcentaje (0–100)
  @Column({ name: 'ping_loss_pct', type: 'smallint', nullable: true })
  pingLossPct: number | null;

  // ── Sistema (solo dispositivos con API/SNMP) ──────────────────
  @Column({ name: 'cpu_usage_pct', type: 'smallint', nullable: true })
  cpuUsagePct: number | null;

  @Column({ name: 'memory_usage_pct', type: 'smallint', nullable: true })
  memoryUsagePct: number | null;

  // ── Tráfico (bits por segundo) ────────────────────────────────
  @Column({ name: 'traffic_down_bps', type: 'bigint', nullable: true })
  trafficDownBps: string | null; // bigint se deserializa como string en TypeORM

  @Column({ name: 'traffic_up_bps', type: 'bigint', nullable: true })
  trafficUpBps: string | null;

  // ── Tiempo ────────────────────────────────────────────────────
  // SIN default a nivel TypeORM para no perder precisión de la medición real.
  // El worker de monitoreo setea este valor antes de persistir.
  @Column({ name: 'timestamp', type: 'timestamptz' })
  @Index('idx_metricas_timestamp')
  timestamp: Date;
}
