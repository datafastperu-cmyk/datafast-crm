import {
  Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

// Read-model: snapshot del estado TR-069 (CPE) de una ONU, poblado desde GenieACS
// (NBI). La UI lee de aquí (instantáneo); el ACS/CPE solo se consulta on-demand.
// Se correlaciona con el inventario/contratos por Serial Number (mismo criterio de
// sufijo hex que el resto del sistema). Un registro por (empresa, genie_id).
@Entity('tr069_device')
@Index('idx_tr069_empresa', ['empresaId'])
@Index('idx_tr069_sn',      ['sn'])
@Index('uq_tr069_genie', ['empresaId', 'genieId'], { unique: true })
export class Tr069Device {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId: string;

  // _id del device en GenieACS (típicamente OUI-ProductClass-Serial).
  @Column({ name: 'genie_id', type: 'varchar', length: 200 }) genieId: string;

  @Column({ type: 'varchar', length: 64 }) sn: string;
  @Column({ type: 'varchar', length: 32, nullable: true }) oui: string | null;
  @Column({ name: 'product_class', type: 'varchar', length: 128, nullable: true }) productClass: string | null;
  @Column({ name: 'software_version', type: 'varchar', length: 128, nullable: true }) softwareVersion: string | null;
  @Column({ name: 'connection_request_url', type: 'text', nullable: true }) connectionRequestUrl: string | null;
  @Column({ name: 'last_inform', type: 'timestamptz', nullable: true }) lastInform: Date | null;

  // Parámetros TR-069 relevantes ya normalizados (wifi, wan, ip, etc.). Flexible por
  // heterogeneidad de modelos (TR-098 vs TR-181): la normalización vive en el servicio.
  @Column({ type: 'jsonb', default: {} }) params: Record<string, unknown>;

  @Column({ name: 'snapshot_at', type: 'timestamptz' }) snapshotAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
