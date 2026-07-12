import { Column, Entity } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type EstadoServicePort = 'libre' | 'ocupado';
/** Canal del pool: 'datos' (GPON/PPPoE) | 'gestion' (bootstrap TR-069 en VLAN de gestión). */
export type CanalServicePort = 'datos' | 'gestion';

@Entity('olt_service_port_pool')
export class OltServicePortPool extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'canal', type: 'varchar', length: 16, default: 'datos' })
  canal: CanalServicePort;

  @Column({ name: 'service_port_id', type: 'int' })
  servicePortId: number;

  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'libre' })
  estado: EstadoServicePort;

  @Column({ name: 'contrato_id', type: 'uuid', nullable: true })
  contratoId: string | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;
}
