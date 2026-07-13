import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// ─── Site ───────────────────────────────────────────────────────
// Tabla: sites
// Incremento 1 del roadmap de arquitectura de infraestructura:
// agrupa Router MikroTik + VPN + OLT bajo un mismo nodo de red.
// El Router es 1:1 con el Site (routerId único); OLTs y VpnCliente
// cuelgan indirectamente vía Router.routerId — no se toca su FK.
@Entity('sites')
@Index('idx_sites_empresa_activo', ['empresaId', 'activo'])
@Index('idx_sites_router', ['routerId'], { unique: true, where: '"deleted_at" IS NULL' })
export class Site extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  // ── Identificación ────────────────────────────────────────
  @Column({ length: 150 })
  nombre: string;   // Ej: "Nodo Norte - Cabecera Principal"

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ length: 200, nullable: true })
  ubicacion: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  // ── Zona ERP vinculada (para cross-ref de contratos) ─────
  @Column({ name: 'zona_id', type: 'uuid', nullable: true })
  zonaId: string | null;

  // ── Relación raíz: 1 Site → 1 Router de cabecera ──────────
  // ON DELETE RESTRICT — no se puede borrar el router si tiene Site.
  // Nullable en esta fase: permite crear el Site antes de asociar router,
  // o migrar Sites huérfanos sin bloquear el alta.
  @Column({ name: 'router_id', type: 'uuid', nullable: true })
  routerId: string | null;

  @Column({ default: true })
  activo: boolean;
}
