import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type EstadoVpnCliente = 'pendiente' | 'conectado' | 'desconectado' | 'revocado';

@Entity('vpn_clientes')
@Index(['empresaId', 'activo'])
@Index(['nombreCert'], { unique: true })
@Index(['tokenDescarga'])
export class VpnCliente extends BaseModel {

  @Column({ name: 'empresa_id', length: 36 })
  empresaId: string;

  // ── Identificación ────────────────────────────────────────
  @Column({ length: 100 })
  nombre: string;

  @Column({ length: 200, nullable: true })
  ubicacion: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  // ── PKI ───────────────────────────────────────────────────
  @Column({ name: 'nombre_cert', length: 100, unique: true })
  nombreCert: string;

  @Column({ name: 'version_ros', length: 5, default: 'v7' })
  versionRos: 'v6' | 'v7';

  // ── Estado ────────────────────────────────────────────────
  @Column({ length: 20, default: 'pendiente' })
  estado: EstadoVpnCliente;

  @Column({ name: 'vpn_ip', length: 20, nullable: true })
  vpnIp: string;  // IP VPN asignada cuando se conecta (10.8.1.x)

  @Column({ name: 'router_id', length: 36, nullable: true })
  routerId: string;  // FK al Router auto-registrado

  // ── Token de descarga ─────────────────────────────────────
  @Column({ name: 'token_descarga', length: 64 })
  tokenDescarga: string;  // Token temporal para descarga de certs

  @Column({ name: 'token_expires_at', type: 'timestamptz' })
  tokenExpiresAt: Date;

  // ── Monitoreo ─────────────────────────────────────────────
  @Column({ name: 'ultimo_handshake', type: 'timestamptz', nullable: true })
  ultimoHandshake: Date;

  @Column({ name: 'ip_real', length: 50, nullable: true })
  ipReal: string;  // IP pública real del router

  @Column({ default: true })
  activo: boolean;
}
