import { Column, Entity } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type EstadoMgmtIp = 'libre' | 'ocupado';

// Pool de IPs estáticas de gestión TR-069 (canal propio del ERP, VLAN de gestión
// canónica — nunca la infraestructura de SmartOLT). Ver migración
// CreateOltMgmtIpPool1791800000003 para la causa raíz que motivó esta tabla.
@Entity('olt_mgmt_ip_pool')
export class OltMgmtIpPool extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'ip_address', type: 'inet' })
  ipAddress: string;

  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'libre' })
  estado: EstadoMgmtIp;

  @Column({ name: 'contrato_id', type: 'uuid', nullable: true })
  contratoId: string | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;
}
