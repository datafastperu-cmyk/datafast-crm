import { Column, Entity } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type EstadoServicePort = 'libre' | 'ocupado';

@Entity('olt_service_port_pool')
export class OltServicePortPool extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'service_port_id', type: 'int' })
  servicePortId: number;

  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'libre' })
  estado: EstadoServicePort;

  @Column({ name: 'contrato_id', type: 'uuid', nullable: true })
  contratoId: string | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;
}
