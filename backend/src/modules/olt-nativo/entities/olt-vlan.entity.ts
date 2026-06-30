import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('olt_vlans')
@Index('idx_olt_vlans_empresa', ['empresaId'])
@Index('idx_olt_vlans_olt',    ['oltId'])
export class OltVlan {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId: string;
  @Column({ name: 'olt_id',     type: 'uuid' }) oltId:     string;
  @Column({ name: 'vlan_id',    type: 'int'  }) vlanId:    number;
  @Column({ type: 'varchar', length: 64 })       nombre:    string;
  @Column({ type: 'text', nullable: true })       descripcion: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
