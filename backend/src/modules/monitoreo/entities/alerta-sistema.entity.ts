// Ruta: /opt/datafast/backend/src/modules/monitoreo/entities/alerta-sistema.entity.ts

import {
  Column, CreateDateColumn, Entity, Index,
  JoinColumn, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { NivelAlerta, StatusAlerta } from '../enums/monitoreo.enums';
import { DispositivoMonitoreo }       from './dispositivo-monitoreo.entity';

@Entity('alertas_sistema')
@Index('idx_alerta_disp_status', ['dispositivoId', 'status'])
@Index('idx_alerta_empresa',     ['empresaId'])
@Index('idx_alerta_nivel',       ['nivel'])
export class AlertaSistema {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Dispositivo origen ────────────────────────────────────────
  @Column({ name: 'dispositivo_id' })
  dispositivoId: string;

  @ManyToOne(() => DispositivoMonitoreo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispositivo_id' })
  dispositivo: DispositivoMonitoreo;

  // ── Clasificación ─────────────────────────────────────────────
  @Column({
    name:    'nivel',
    type:    'enum',
    enum:    NivelAlerta,
    default: NivelAlerta.WARNING,
  })
  nivel: NivelAlerta;

  // Categoría corta para filtrado rápido (ej: 'PING', 'CPU', 'MEMORIA', 'TRÁFICO')
  @Column({ name: 'categoria', length: 40, nullable: true })
  categoria: string | null;

  // ── Contenido ─────────────────────────────────────────────────
  @Column({ name: 'mensaje', type: 'text' })
  mensaje: string;

  // Valor que disparó la alerta (ej: "95" para cpu 95%)
  @Column({ name: 'valor_detectado', length: 50, nullable: true })
  valorDetectado: string | null;

  // Umbral que fue superado (ej: "80" para cpu threshold 80%)
  @Column({ name: 'valor_umbral', length: 50, nullable: true })
  valorUmbral: string | null;

  // ── Ciclo de vida ─────────────────────────────────────────────
  @Column({
    name:    'status',
    type:    'enum',
    enum:    StatusAlerta,
    default: StatusAlerta.ACTIVA,
  })
  status: StatusAlerta;

  @Column({ name: 'resuelto_at', type: 'timestamptz', nullable: true })
  resueltoAt: Date | null;

  // Usuario que marcó la alerta como resuelta (nullable = auto-resuelta)
  @Column({ name: 'resuelto_por_id', nullable: true })
  resueltoPorId: string | null;

  // ── Auditoría ─────────────────────────────────────────────────
  // Sin deleted_at: las alertas son registros permanentes de auditoría.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
