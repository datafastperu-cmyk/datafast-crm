import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, Index, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { OltDispositivo } from './olt-dispositivo.entity';

@Entity('olt_boards')
@Index('idx_olt_boards_empresa', ['empresaId'])
@Index('idx_olt_boards_olt', ['oltId'])
export class OltBoard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ type: 'smallint' })
  slot: number;

  @Column({ name: 'board_type', type: 'varchar', length: 64 })
  boardType: string;

  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  estado: string;

  @Column({ name: 'onu_count', type: 'smallint', default: 0 })
  onuCount: number;

  @Column({ name: 'ports_per_slot', type: 'smallint', nullable: true })
  portsPorSlot: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => OltDispositivo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'olt_id' })
  olt: OltDispositivo;
}
