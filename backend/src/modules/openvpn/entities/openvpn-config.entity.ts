import { Entity, Column } from 'typeorm';
import { BaseModel }      from '../../../common/entities/base.entity';

@Entity('openvpn_config')
export class OpenvpnConfig extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 100, default: 'Servidor VPN' })
  nombre: string;

  @Column({ name: 'servidor_ip', length: 100 })
  servidorIp: string;

  @Column({ type: 'smallint', default: 1194 })
  puerto: number;

  @Column({ length: 10, default: 'tcp' })
  protocolo: string;  // tcp | udp

  @Column({ length: 10, default: 'tun' })
  dispositivo: string;  // tun | tap

  @Column({ name: 'vpn_network', length: 20, default: '10.8.0.0' })
  vpnNetwork: string;

  @Column({ name: 'vpn_netmask', length: 20, default: '255.255.255.0' })
  vpnNetmask: string;

  // ── Certificados PKI ──────────────────────────────────────────
  @Column({ name: 'ca_cert', type: 'text', nullable: true })
  caCert: string;

  @Column({ name: 'server_cert', type: 'text', nullable: true })
  serverCert: string;

  @Column({ name: 'server_key', type: 'text', nullable: true })
  serverKey: string;

  @Column({ name: 'dh_params', type: 'text', nullable: true })
  dhParams: string;

  // Clave TLS-Crypt (protección adicional del canal de control OpenVPN)
  @Column({ name: 'ta_key', type: 'text', nullable: true })
  taKey: string;

  // ── Metadata de la instalación en el servidor ─────────────────
  @Column({ name: 'installed_at', type: 'timestamptz', nullable: true })
  installedAt: Date;

  @Column({ name: 'ca_expiry', length: 100, nullable: true })
  caExpiry: string;

  @Column({ name: 'server_expiry', length: 100, nullable: true })
  serverExpiry: string;

  @Column({ default: true })
  activo: boolean;
}
