import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// OltBaseline — Incremento 8 (DISP: Baseline versionado)
//
// Reemplaza el concepto de "configuración inicial": una OLT no se
// configura, recibe un Baseline — un artefacto declarativo con
// identidad y versión que define qué recursos DEBE tener. El
// compliance compara el baseline contra el InfrastructureSnapshot;
// la aplicación (convergencia) llega en el Incremento 9.
//
// Versionado: (empresa_id, nombre, version) es único. Editar un
// baseline crea una versión nueva — nunca se muta una publicada,
// para que el historial de qué se exigió en cada momento sea auditable.
// ─────────────────────────────────────────────────────────────

export interface BaselineVlanSpec {
  vlanId:     number;
  nombre:     string;
  proposito?: string;   // ej. 'internet', 'gestion', 'iptv', 'voip'
  uplink?:    boolean;  // true → debe estar taggeada en spec.uplinkPort (9b)
}

export interface BaselineTrafficTableSpec {
  nombre:  string;      // se busca por nombre en la OLT (el índice lo asigna la OLT)
  cirKbps: number;
  pirKbps: number;
}

export interface BaselineSpec {
  vlans:         BaselineVlanSpec[];
  trafficTables: BaselineTrafficTableSpec[];
  ntpServers?:   string[];
  // Puerto uplink físico donde se tagean las VLANs con uplink:true.
  // Formato frame/slot/port (ej. '0/9/0' — MPLB activa en MA5800-X7).
  // El tagging es SOLO aditivo; el destagueo nunca se automatiza.
  uplinkPort?:   string;
}

@Entity('olt_baselines')
@Index('idx_olt_baselines_empresa', ['empresaId'])
@Index('uq_olt_baseline_nombre_version', ['empresaId', 'nombre', 'version'], { unique: true })
export class OltBaseline {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId: string;

  @Column({ type: 'varchar', length: 100 }) nombre: string;

  @Column({ type: 'int', default: 1 }) version: number;

  @Column({ type: 'text', nullable: true }) descripcion: string | null;

  @Column({ type: 'jsonb' }) spec: BaselineSpec;

  @Column({ type: 'boolean', default: true }) activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
