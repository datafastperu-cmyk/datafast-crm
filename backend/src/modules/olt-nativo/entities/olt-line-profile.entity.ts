import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, Index, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { OltDispositivo } from './olt-dispositivo.entity';

@Entity('olt_line_profiles')
@Index('idx_olt_lp_empresa', ['empresaId'])
@Index('idx_olt_lp_olt', ['oltId'])
export class OltLineProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'profile_id', type: 'int' })
  profileId: number;

  @Column({ type: 'varchar', length: 128 })
  nombre: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => OltDispositivo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'olt_id' })
  olt: OltDispositivo;
}
