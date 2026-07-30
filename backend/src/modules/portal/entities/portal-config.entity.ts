import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

// Configuración del Portal del Cliente — una fila por empresa.
// Nota SWC: todas las columnas nullable declaran `type` explícito. Sin él, el
// metadato emitido para `string | null` es `Object` y TypeORM crashea al arrancar en frío.
@Entity('portal_config')
@Index(['empresaId'], { unique: true })
export class PortalConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  // ── General ──────────────────────────────────────────────────
  // URL pública para los avisos al cliente. NO configura nginx: el host que sirve el
  // portal es PORTAL_DOMAIN del .env.
  @Column({ name: 'url_portal', type: 'varchar', length: 255, nullable: true })
  urlPortal: string | null;

  @Column({ type: 'varchar', length: 100, default: 'Portal del Cliente' })
  titulo: string;

  @Column({ name: 'url_test_velocidad', type: 'varchar', length: 255, nullable: true })
  urlTestVelocidad: string | null;

  @Column({ name: 'titulo_menu_personalizado', type: 'varchar', length: 100, nullable: true })
  tituloMenuPersonalizado: string | null;

  // Texto plano. Nunca HTML — se sirve a todo el parque de abonados.
  @Column({ name: 'contenido_menu_personalizado', type: 'text', nullable: true })
  contenidoMenuPersonalizado: string | null;

  // ── Secciones habilitadas ────────────────────────────────────
  @Column({ name: 'mostrar_comprobantes', type: 'boolean', default: true })
  mostrarComprobantes: boolean;

  @Column({ name: 'mostrar_soporte', type: 'boolean', default: true })
  mostrarSoporte: boolean;

  @Column({ name: 'mostrar_informar_pago', type: 'boolean', default: true })
  mostrarInformarPago: boolean;

  @Column({ name: 'mostrar_test_velocidad', type: 'boolean', default: true })
  mostrarTestVelocidad: boolean;

  @Column({ name: 'mostrar_notificaciones', type: 'boolean', default: true })
  mostrarNotificaciones: boolean;

  @Column({ name: 'mostrar_wifi', type: 'boolean', default: true })
  mostrarWifi: boolean;

  @Column({ name: 'mostrar_dispositivos', type: 'boolean', default: true })
  mostrarDispositivos: boolean;

  @Column({ name: 'mostrar_planes', type: 'boolean', default: false })
  mostrarPlanes: boolean;

  @Column({ name: 'mostrar_banner', type: 'boolean', default: false })
  mostrarBanner: boolean;

  @Column({ name: 'mostrar_menu_personalizado', type: 'boolean', default: false })
  mostrarMenuPersonalizado: boolean;

  // Apagado mientras no exista colector de consumo (ver §4 del documento).
  @Column({ name: 'mostrar_consumo', type: 'boolean', default: false })
  mostrarConsumo: boolean;

  // ── Reporte de pago ──────────────────────────────────────────
  @Column({ name: 'reporte_pago_destinatarios', type: 'text', nullable: true })
  reportePagoDestinatarios: string | null;

  @Column({ name: 'reporte_pago_medios', type: 'text', nullable: true })
  reportePagoMedios: string | null;

  // ── Diseño ───────────────────────────────────────────────────
  @Column({ name: 'logo_url', type: 'varchar', length: 255, nullable: true })
  logoUrl: string | null;

  @Column({ name: 'color_primario', type: 'varchar', length: 9, default: '#16A34A' })
  colorPrimario: string;

  @Column({ type: 'varchar', length: 10, default: 'claro' })
  tema: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
