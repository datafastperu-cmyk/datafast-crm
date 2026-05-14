import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

@Entity('segmentos_ipv4')
@Index(['empresaId', 'activo'])
export class SegmentoIpv4 extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'router_id', nullable: true })
  routerId: string;

  @Column({ name: 'nodo_id', nullable: true })
  nodoId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ name: 'red_cidr', type: 'cidr' })
  redCidr: string;   // ej: '192.168.1.0/24'

  @Column({ type: 'inet' })
  gateway: string;

  @Column({ name: 'dns_primario', type: 'inet', default: '8.8.8.8' })
  dnsPrimario: string;

  @Column({ name: 'dns_secundario', type: 'inet', nullable: true })
  dnsSecundario: string;

  @Column({ name: 'ips_reservadas', type: 'inet', array: true, nullable: true })
  ipsReservadas: string[];

  @Column({ name: 'total_ips', default: 0 })
  totalIps: number;

  @Column({ name: 'ips_usadas', default: 0 })
  ipsUsadas: number;

  // ips_disponibles = columna generada en BD
  @Column({ name: 'ips_disponibles', type: 'int', insert: false, update: false, nullable: true })
  ipsDisponibles: number;

  @Column({
    name: 'tipo_servicio',
    length: 20,
    default: 'ftth',
  })
  tipoServicio: string;

  @Column({ name: 'vlan_id', type: 'smallint', nullable: true })
  vlanId: number;

  @Column({ default: true })
  activo: boolean;

  get porcentajeUso(): number {
    if (!this.totalIps) return 0;
    return Math.round((this.ipsUsadas / this.totalIps) * 100);
  }
}

@Entity('ips_asignadas')
@Index(['segmentoId', 'activa'])
@Index(['ipAddress'])
export class IpAsignada {
  @Column({ type: 'uuid', primary: true, generated: 'uuid' })
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'segmento_id' })
  segmentoId: string;

  @Column({ name: 'contrato_id', nullable: true })
  contratoId: string;

  @Column({ name: 'ip_address', type: 'inet' })
  ipAddress: string;

  @Column({ length: 200, nullable: true })
  descripcion: string;

  @Column({ length: 30, default: 'cliente' })
  tipo: string;

  @Column({ default: true })
  activa: boolean;

  @Column({ name: 'asignada_en', type: 'timestamptz', default: () => 'NOW()' })
  asignadaEn: Date;

  @Column({ name: 'liberada_en', type: 'timestamptz', nullable: true })
  liberadaEn: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
