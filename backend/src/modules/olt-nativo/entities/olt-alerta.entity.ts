import { Entity, Column, Index, PrimaryGeneratedColumn } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// OltAlerta
// Tabla: olt_alertas
//
// Motor de alertas del módulo OLT. Una alerta nace con estado
// 'activa', puede silenciarse o auto-resolverse cuando la
// condición que la generó desaparece.
//
// Deduplicación garantizada por índice UNIQUE parcial creado
// en la migración:
//   UNIQUE (olt_id, tipo, COALESCE(entidad_ref, ''))
//   WHERE estado = 'activa'
//
// No extiende BaseModel: no usa soft-delete ni version (las
// alertas se resuelven o silencian, nunca se borran).
// ─────────────────────────────────────────────────────────────

export type AlertaSeveridad = 'critica' | 'alta' | 'media' | 'baja';
export type AlertaEstado    = 'activa'  | 'resuelta' | 'silenciada';
export type AlertaTipo      =
  | 'olt_inaccesible'
  | 'board_fault'
  | 'pom_temp_warn'
  | 'pom_temp_critical'
  | 'pom_tx_degradado'
  | 'pom_rx_warn'
  | 'onu_offline'
  | 'onu_rogue'
  | 'onu_sin_contrato'
  | 'pool_agotado'
  | 'pool_casi_agotado'
  | 'reconexion_sin_pago';

@Entity('olt_alertas')
@Index('idx_olt_alertas_empresa_activa', ['empresaId', 'estado', 'severidad'])
@Index('idx_olt_alertas_olt_ts',         ['oltId',     'createdAt'])
@Index('idx_olt_alertas_contrato',       ['contratoId'])
export class OltAlerta {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id' })
  oltId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // critica | alta | media | baja
  @Column({ type: 'varchar', length: 10 })
  severidad: AlertaSeveridad;

  // Tipo de alerta — define la regla que la generó
  @Column({ type: 'varchar', length: 50 })
  tipo: AlertaTipo;

  @Column({ type: 'text' })
  mensaje: string;

  // activa | resuelta | silenciada
  @Column({ type: 'varchar', length: 20, default: 'activa' })
  estado: AlertaEstado;

  // onu | board | port | pool
  @Column({ name: 'entidad_tipo', type: 'varchar', length: 20, nullable: true })
  entidadTipo: string | null;

  // Referencia a la entidad afectada. Ej: "0/1/2", "slot:0", "pool:svc"
  // Usado por el índice UNIQUE de deduplicación
  @Column({ name: 'entidad_ref', type: 'varchar', length: 50, nullable: true })
  entidadRef: string | null;

  // FK al contrato afectado (si aplica — onu_offline con contrato activo)
  @Column({ name: 'contrato_id', type: 'varchar', nullable: true })
  contratoId: string | null;

  // Silenciar hasta esta fecha (mantenimientos programados)
  @Column({ name: 'silenced_until', type: 'timestamptz', nullable: true })
  silencedUntil: Date | null;

  // Timestamp de la última notificación (evita re-notificar en cada poll)
  @Column({ name: 'notificado_at', type: 'timestamptz', nullable: true })
  notificadoAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
