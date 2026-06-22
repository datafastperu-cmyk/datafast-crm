import {
  Column, CreateDateColumn, Entity, Index,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

// ─── Tipos ───────────────────────────────────────────────────

export type TipoOperacion =
  | 'provision'
  | 'deprovision'
  | 'test_conexion'
  | 'discover'
  | 'metricas'
  | 'estado_onu';

export type EstadoOperacion = 'pendiente' | 'exitoso' | 'fallido';

// ─────────────────────────────────────────────────────────────
// OltOperacionLog
// Tabla: olt_operacion_log
//
// Registro INMUTABLE de cada operación ejecutada sobre una OLT.
// Doble función:
//   1. Auditoría — quién hizo qué, cuándo y con qué resultado.
//   2. Idempotencia — previene ejecución duplicada vía
//      idempotency_key con índice UNIQUE parcial (solo exitosas).
//
// No se eliminan filas. Sin soft-delete.
// ─────────────────────────────────────────────────────────────
@Entity('olt_operacion_log')
@Index('idx_olt_op_empresa_fecha', ['empresaId', 'createdAt'])
@Index('idx_olt_op_olt_sn_fecha',  ['oltId', 'onuSn', 'createdAt'])
export class OltOperacionLog {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'olt_id' })
  oltId: string;

  // NULL en operaciones a nivel OLT (test_conexion, discover sin SN)
  @Column({ name: 'onu_sn', type: 'varchar', length: 20, nullable: true })
  onuSn: string | null;

  // 'provision' | 'deprovision' | 'test_conexion' | 'discover' | 'metricas' | 'estado_onu'
  @Column({ name: 'tipo', type: 'varchar', length: 20 })
  tipo: TipoOperacion;

  // SHA-1 determinista del contexto. NULL cuando no se usa idempotencia.
  // El índice UNIQUE parcial en BD garantiza exactamente una ejecución exitosa por clave.
  @Column({ name: 'idempotency_key', type: 'varchar', length: 120, nullable: true })
  idempotencyKey: string | null;

  // Array ordenado de proveedores intentados. Ej: ['nativo_ssh', 'smartolt']
  @Column({ name: 'proveedores_intentados', type: 'text', array: true, default: [] })
  proveedoresIntentados: string[];

  // Proveedor que respondió con éxito. NULL si todos fallaron.
  @Column({ name: 'proveedor_exitoso', type: 'varchar', length: 20, nullable: true })
  proveedorExitoso: string | null;

  // 'pendiente' | 'exitoso' | 'fallido'
  @Column({ name: 'estado', type: 'varchar', length: 10, default: 'pendiente' })
  estado: EstadoOperacion;

  // Payload completo de retorno del proveedor exitoso.
  @Column({ name: 'resultado', type: 'jsonb', nullable: true })
  resultado: Record<string, unknown> | null;

  // Mensaje del último error (útil cuando todos los proveedores fallaron).
  @Column({ name: 'error_mensaje', type: 'text', nullable: true })
  errorMensaje: string | null;

  // Tiempo total incluyendo todos los intentos de fallback.
  @Column({ name: 'duracion_ms', type: 'int', nullable: true })
  duracionMs: number | null;

  // NULL cuando la operación fue disparada por un cron/sistema.
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
