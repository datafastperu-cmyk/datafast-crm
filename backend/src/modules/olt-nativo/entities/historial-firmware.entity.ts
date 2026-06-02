import {
  Column, CreateDateColumn, Entity, Index,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

export type EstadoFirmware =
  | 'pendiente'
  | 'transfiriendo'
  | 'exitoso'
  | 'parcial'
  | 'fallido';

// Registro de auditoría para cada operación de firmware OMCI.
// Sin soft-delete: es un log permanente de operaciones críticas.
@Entity('historial_firmware')
@Index('idx_hfw_olt',     ['oltId'])
@Index('idx_hfw_empresa', ['empresaId', 'createdAt'])
@Index('idx_hfw_estado',  ['estado'])
export class HistorialFirmware {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── OLT destino ──────────────────────────────────────────
  @Column({ name: 'olt_id' })
  oltId: string;

  @Column({ name: 'olt_nombre', length: 150 })
  oltNombre: string;

  // ── Archivo de firmware ───────────────────────────────────
  @Column({ name: 'firmware_filename', length: 200 })
  firmwareFilename: string;

  @Column({ name: 'firmware_size_bytes', type: 'int' })
  firmwareSizeBytes: number;

  @Column({ name: 'firmware_path', type: 'text' })
  firmwarePath: string;  // /tmp/firmware/{id}/{filename} — solo durante transferencia

  // ── Parámetros de la operación ────────────────────────────
  @Column({ type: 'smallint' })
  slot: number;

  @Column({ type: 'smallint' })
  port: number;

  @Column({ name: 'onu_ids', type: 'jsonb' })
  onuIds: number[];

  // ── Trazabilidad ──────────────────────────────────────────
  @Column({ name: 'uploaded_by' })
  uploadedBy: string;  // userId del administrador

  @Column({ name: 'uploaded_by_email', length: 200, nullable: true })
  uploadedByEmail: string | null;

  // ── Estado del proceso ────────────────────────────────────
  @Column({ name: 'estado', length: 30, default: 'pendiente' })
  estado: EstadoFirmware;

  @Column({ name: 'python_job_id', length: 40, nullable: true })
  pythonJobId: string | null;

  @Column({ name: 'resultado', type: 'jsonb', nullable: true })
  resultado: Array<{ onu_id: number; status: string; message: string }> | null;

  @Column({ name: 'error_msg', type: 'text', nullable: true })
  errorMsg: string | null;

  // ── Auditoría ─────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
