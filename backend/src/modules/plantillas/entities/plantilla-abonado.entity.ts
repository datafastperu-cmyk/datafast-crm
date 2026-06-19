import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export interface FacturacionConfig {
  tipo:             string;
  diaPago:          string;
  crearFactura:     string;
  plantillaAvisoFactura?: string;
  esquemaImpuesto:  string;
  diasGracia:       string;
  aplicarCorte:     string;
  aplicarMora:      boolean;
  montoMora:        number;
  aplicarReconexion: boolean;
  montoReconexion:  number;
  impuesto1:        number;
}

export interface NotificacionesConfig {
  avisoNuevaFactura:      string;
  avisoPantalla:          string;
  recordatoriosPago:      string;
  recordatorio1:          string;
  recordatorio2:          string;
  recordatorio3:          string;
  plantillaRecordatorio1?: string;
  plantillaRecordatorio2?: string;
  plantillaRecordatorio3?: string;
}

@Entity('plantillas_abonados')
@Index(['empresaId'])
export class PlantillaAbonado extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 150 })
  nombre: string;

  @Column({ type: 'jsonb' })
  facturacion: FacturacionConfig;

  @Column({ type: 'jsonb' })
  notificaciones: NotificacionesConfig;

  @Column({ name: 'es_default', default: false })
  esDefault: boolean;
}
