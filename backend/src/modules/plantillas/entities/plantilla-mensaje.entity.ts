import { Entity, Column, Index, Unique } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type TipoPlantilla = 'whatsapp' | 'email' | 'documento';

@Entity('plantillas_mensajes')
@Index(['empresaId', 'tipo'])
@Unique(['empresaId', 'tipo', 'codigo'])
export class PlantillaMensaje extends BaseModel {
  @Column({ name: 'empresa_id' }) empresaId: string;
  @Column({ type: 'varchar', length: 20 }) tipo: TipoPlantilla;
  @Column({ length: 50 }) codigo: string;
  @Column({ length: 150 }) nombre: string;
  @Column({ type: 'text' }) contenido: string;
  @Column({ default: true }) activo: boolean;
}
