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

  @Column({ name: 'whatsapp_corporativo', type: 'varchar', length: 20, nullable: true })
  whatsappCorporativo: string | null;

  @Column({ name: 'telefono_informativo', type: 'varchar', length: 30, nullable: true })
  telefonoInformativo: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ name: 'sitio_web', type: 'varchar', length: 250, nullable: true })
  websiteUrl: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 500, nullable: true })
  logoUrl: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  dominio: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  pais: string | null;

  @Column({ name: 'zona_horaria', length: 50, default: 'America/Lima' })
  zonaHoraria: string;

  // serie_boleta, serie_factura, igv_rate, moneda, tipo_comprobante_default
  // fueron migrados a comprobantes_config y configuracion_facturacion.
  // Se mantiene dia_facturacion y dias_gracia porque son operativos (cobranza),
  // no de facturación fiscal.

  @Column({ name: 'dia_facturacion', type: 'smallint', default: 1 })
  diaFacturacion: number;

  @Column({ name: 'dias_gracia', type: 'smallint', default: 5 })
  diasGraciaCorte: number;

  @Column({ default: 'activo' })
  estado: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
