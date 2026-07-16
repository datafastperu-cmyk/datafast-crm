import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type VlanOrigen = 'erp' | 'olt';
export type VlanEstado = 'active' | 'syncing' | 'error';

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

  // Observed state (9c): tipo real y uso real leídos de 'display vlan all'.
  // Claves para verificar compatibilidad antes de adoptar una VLAN ajena.
  @Column({ type: 'varchar', length: 10, nullable: true })
  tipo: string | null;              // smart | mux | standard | super

  @Column({ name: 'serv_ports', type: 'int', nullable: true })
  servPorts: number | null;         // service-ports activos en la OLT

  // Ownership: lo desconocido es externo ('olt'); 'erp' se declara explícito
  // al crear la VLAN desde el panel. El ERP nunca muta recursos origen != 'erp'.
  @Column({ type: 'varchar', length: 10, default: 'olt' })
  origen: VlanOrigen;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  estado: VlanEstado;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
