import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../common/entities/base.entity';

export enum EstadoBackup {
  EN_PROGRESO = 'en_progreso',
  COMPLETADO  = 'completado',
  ERROR       = 'error',
}

export enum TipoBackup {
  MANUAL = 'manual',
  AUTO   = 'auto',
}

export enum EstadoSubida {
  PENDIENTE     = 'pendiente',
  SUBIDO        = 'subido',
  ERROR         = 'error',
  DESHABILITADO = 'deshabilitado',
}

@Entity('backups')
@Index(['empresaId', 'createdAt'])
export class Backup extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ type: 'enum', enum: TipoBackup, default: TipoBackup.AUTO })
  tipo: TipoBackup;

  @Column({ type: 'enum', enum: EstadoBackup, default: EstadoBackup.EN_PROGRESO })
  estado: EstadoBackup;

  @Column({ name: 'archivo_local', length: 500, nullable: true })
  archivoLocal: string;

  @Column({ name: 'tamano_bytes', type: 'bigint', nullable: true })
  tamanoBytes: number;

  @Column({ type: 'text', array: true, default: '{}' })
  contenido: string[];

  @Column({ name: 'drive_file_id', length: 200, nullable: true })
  driveFileId: string;

  @Column({ name: 'drive_url', length: 500, nullable: true })
  driveUrl: string;

  @Column({ name: 'drive_estado', type: 'enum', enum: EstadoSubida, default: EstadoSubida.PENDIENTE })
  driveEstado: EstadoSubida;

  @Column({ name: 'correo_estado', type: 'enum', enum: EstadoSubida, default: EstadoSubida.PENDIENTE })
  correoEstado: EstadoSubida;

  @Column({ name: 'error_mensaje', type: 'text', nullable: true })
  errorMensaje: string;

  @Column({ type: 'jsonb', default: '[]' })
  logs: string[];

  @Column({ name: 'completado_en', type: 'timestamptz', nullable: true })
  completadoEn: Date;

  @Column({ name: 'creado_por', length: 200, default: 'sistema' })
  creadoPor: string;
}
