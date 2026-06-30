import { Column, Entity } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type EstadoOnuId = 'libre' | 'ocupado';

@Entity('olt_onu_id_pool')
export class OltOnuIdPool extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ type: 'smallint' })
  slot: number;

  @Column({ type: 'smallint' })
  port: number;

  @Column({ name: 'onu_id', type: 'smallint' })
  onuId: number;

  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'libre' })
  estado: EstadoOnuId;

  @Column({ name: 'contrato_id', type: 'uuid', nullable: true })
  contratoId: string | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;
}
