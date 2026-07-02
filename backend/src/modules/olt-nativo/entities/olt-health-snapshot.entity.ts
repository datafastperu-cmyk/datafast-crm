import { Entity, Column, Index, PrimaryGeneratedColumn } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// OltHealthSnapshot
// Tabla: olt_health_snapshots
//
// Almacén TSDB-like para datos de salud de la OLT:
//   - POM por puerto PON (temperatura, potencia TX/RX, láser)
//   - Estado de boards/slots
//   - Contadores de ONUs por puerto
//
// Retención gestionada por cron (OltHealthPollerService):
//   raw  → 7 días
//   hour → 30 días
//   day  → 1 año
//
// No extiende BaseModel: snapshots son inmutables, no tienen
// soft-delete ni version (se purgan por política de retención).
// ─────────────────────────────────────────────────────────────
@Entity('olt_health_snapshots')
@Index('idx_health_olt_ts',        ['oltId', 'capturedAt'])
@Index('idx_health_slot_port',     ['oltId', 'slot', 'port', 'capturedAt'])
@Index('idx_health_empresa_ts',    ['empresaId', 'capturedAt'])
export class OltHealthSnapshot {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id' })
  oltId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // 'board' | 'pom' | 'pon_port'
  @Column({ name: 'snapshot_type', length: 20, default: 'board' })
  snapshotType: 'board' | 'pom' | 'pon_port';

  // null → board-level; not null → port-level (pom o pon_port)
  @Column({ type: 'smallint', nullable: true })
  slot: number | null;

  @Column({ type: 'smallint', nullable: true })
  port: number | null;

  // ── POM — Pluggable Optical Module (por puerto PON) ───────────
  @Column({ name: 'temp_celsius',  type: 'numeric', precision: 5, scale: 2, nullable: true })
  tempCelsius: number | null;

  @Column({ name: 'tx_dbm',        type: 'numeric', precision: 6, scale: 3, nullable: true })
  txDbm: number | null;

  @Column({ name: 'rx_dbm',        type: 'numeric', precision: 6, scale: 3, nullable: true })
  rxDbm: number | null;

  @Column({ name: 'voltage_mv',    type: 'numeric', precision: 8, scale: 2, nullable: true })
  voltageMv: number | null;

  @Column({ name: 'laser_ma',      type: 'numeric', precision: 7, scale: 3, nullable: true })
  laserMa: number | null;

  // ok | warn | critical | unavailable
  @Column({ name: 'pom_state', type: 'varchar', length: 20, nullable: true })
  pomState: string | null;

  // ── Board / Slot ───────────────────────────────────────────────
  // Ej: "GPBD", "GPON-8", "X2CS"
  @Column({ name: 'board_type',  type: 'varchar', length: 30, nullable: true })
  boardType: string | null;

  // normal | fault | absent | standby
  @Column({ name: 'board_state', type: 'varchar', length: 20, nullable: true })
  boardState: string | null;

  // Capacidad máxima de ONUs para este slot
  @Column({ name: 'onu_capacity', type: 'smallint', nullable: true })
  onuCapacity: number | null;

  // ── Contadores de ONUs ─────────────────────────────────────────
  @Column({ name: 'onus_online',  type: 'smallint', nullable: true })
  onusOnline: number | null;

  @Column({ name: 'onus_offline', type: 'smallint', nullable: true })
  onusOffline: number | null;

  @Column({ name: 'onus_rogue',   type: 'smallint', nullable: true })
  onusRogue: number | null;

  @Column({ name: 'onus_total',   type: 'smallint', nullable: true })
  onusTotal: number | null;

  // ── Estado PON por puerto (snapshot_type = 'pon_port') ───────
  // GPON | EPON | XGS-PON
  @Column({ name: 'port_type',   type: 'varchar', length: 10,  nullable: true })
  portType: string | null;

  // enabled | disabled
  @Column({ name: 'admin_state', type: 'varchar', length: 30,  nullable: true })
  adminState: string | null;

  // up | down
  @Column({ name: 'oper_state',  type: 'varchar', length: 30,  nullable: true })
  operState: string | null;

  // autofind | manual
  @Column({ name: 'autofind',    type: 'varchar', length: 20,  nullable: true })
  autofind: string | null;

  // ── Meta ───────────────────────────────────────────────────────
  // raw | hour | day
  @Column({ length: 10, default: 'raw' })
  granularity: string;

  @Column({ name: 'captured_at', type: 'timestamptz', default: () => 'NOW()' })
  capturedAt: Date;

  // Payload completo del driver para debugging / parseo futuro
  @Column({ name: 'raw_json', type: 'jsonb', nullable: true })
  rawJson: Record<string, unknown> | null;
}
