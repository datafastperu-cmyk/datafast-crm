import {
  Column, CreateDateColumn, Entity, Index,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

// ─── Tipos ───────────────────────────────────────────────────

export type TipoProveedor = 'nativo_ssh' | 'nativo_snmp' | 'smartolt' | 'adminolt';
export type CircuitEstado  = 'closed' | 'open' | 'half_open';
export type HealthEstado   = 'ok' | 'degraded' | 'down' | 'unknown';

// ─────────────────────────────────────────────────────────────
// OltProveedorConfig
// Tabla: olt_proveedor_config
//
// Registra uno o más proveedores por OLT con su prioridad,
// credenciales cifradas y el estado del circuit breaker
// independiente para cada par (olt_id, tipo).
//
// Un solo proveedor activo basta para operar.
// Máximo un registro por (olt_id, tipo) — restricción UNIQUE en BD.
// ─────────────────────────────────────────────────────────────
@Entity('olt_proveedor_config')
@Index('idx_olt_prov_empresa',      ['empresaId'])
@Index('idx_olt_prov_olt_prioridad',['oltId', 'prioridad'])
export class OltProveedorConfig {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'olt_id' })
  oltId: string;

  // 'nativo_ssh' | 'nativo_snmp' | 'smartolt' | 'adminolt'
  @Column({ name: 'tipo', type: 'varchar', length: 20 })
  tipo: TipoProveedor;

  // Orden de intento: 1 = primario, 2 = fallback-1, etc.
  @Column({ type: 'smallint', default: 1 })
  prioridad: number;

  // Credenciales cifradas en JSONB. Campos por tipo:
  //   nativo_ssh/snmp : { ip, port, username, password_cifrado, brand }
  //   smartolt        : { base_url, api_key_cifrado, olt_id_externo }
  //   adminolt        : { base_url, username, password_cifrado, olt_id_externo }
  @Column({ type: 'jsonb', default: {} })
  credenciales: Record<string, unknown>;

  @Column({ default: true })
  activo: boolean;

  // ── Circuit Breaker ───────────────────────────────────────

  // 'closed' | 'open' | 'half_open'
  @Column({ name: 'circuit_estado', type: 'varchar', length: 15, default: 'closed' })
  circuitEstado: CircuitEstado;

  // Fallos consecutivos. Se resetea a 0 en cada éxito.
  @Column({ name: 'circuit_fallas', type: 'smallint', default: 0 })
  circuitFallas: number;

  // Timestamp hasta el cual el circuito permanece OPEN.
  @Column({ name: 'circuit_abierto_hasta', type: 'timestamptz', nullable: true })
  circuitAbiertoHasta: Date | null;

  // ── Health Monitor ────────────────────────────────────────

  @Column({ name: 'ultimo_health', type: 'timestamptz', nullable: true })
  ultimoHealth: Date | null;

  // 'ok' | 'degraded' | 'down' | 'unknown'
  @Column({ name: 'health_estado', type: 'varchar', length: 10, default: 'unknown' })
  healthEstado: HealthEstado;

  @Column({ name: 'health_latencia_ms', type: 'int', nullable: true })
  healthLatenciaMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
