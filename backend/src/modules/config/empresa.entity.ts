import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('empresas')
export class Empresa {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'razon_social', length: 200 })
  razonSocial: string;

  @Column({ length: 20 })
  ruc: string;

  @Column({ name: 'direccion_fiscal', type: 'text', nullable: true })
  direccion: string | null;

  @Column({ length: 20, nullable: true })
  telefono: string | null;

  @Column({ name: 'telefono_informativo', length: 30, nullable: true })
  telefonoInformativo: string | null;

  @Column({ length: 150, nullable: true })
  email: string | null;

  @Column({ name: 'sitio_web', length: 250, nullable: true })
  websiteUrl: string | null;

  @Column({ name: 'logo_url', length: 500, nullable: true })
  logoUrl: string | null;

  @Column({ length: 250, nullable: true })
  dominio: string | null;

  @Column({ name: 'serie_boleta', length: 10, default: 'B001' })
  serieBoleta: string;

  @Column({ name: 'serie_factura', length: 10, default: 'F001' })
  serieFactura: string;

  @Column({ name: 'igv_rate', type: 'decimal', precision: 5, scale: 4, default: 0.18 })
  igvRate: number;

  @Column({ name: 'dia_facturacion', type: 'smallint', default: 1 })
  diaFacturacion: number;

  @Column({ name: 'dias_gracia', type: 'smallint', default: 5 })
  diasGraciaCorte: number;

  @Column({ name: 'notif_whatsapp_vencimiento', default: true })
  notifWhatsappVencimiento: boolean;

  @Column({ name: 'notif_whatsapp_corte', default: true })
  notifWhatsappCorte: boolean;

  @Column({ default: 'activo' })
  estado: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
