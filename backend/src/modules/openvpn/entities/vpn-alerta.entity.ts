import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type TipoVpnAlerta = 'conexion_bloqueada' | 'sesion_eliminada';

@Entity('vpn_alertas')
@Index(['empresaId', 'leida'])
export class VpnAlerta extends BaseModel {

  @Column({ name: 'empresa_id', length: 36 })
  empresaId: string;

  @Column({ length: 100 })
  cn: string;

  @Column({ name: 'router_id', length: 36, nullable: true })
  routerId: string;

  @Column({ name: 'router_nombre', length: 200, nullable: true })
  routerNombre: string;

  @Column({ type: 'varchar', length: 30 })
  tipo: TipoVpnAlerta;

  // IP pública del dispositivo que intentó conectar
  @Column({ name: 'ip_nueva', length: 50, nullable: true })
  ipNueva: string;

  // IP pública de la sesión activa que fue bloqueada o eliminada
  @Column({ name: 'ip_sesion', length: 50, nullable: true })
  ipSesion: string;

  @Column({ type: 'text' })
  mensaje: string;

  @Column({ default: false })
  leida: boolean;
}
