import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export type XuiEstadoConexion = 'ok' | 'error' | 'sin_probar';

// Una sola fila por empresa — no hay multi-servidor. Reemplaza la
// configuración que antes vivía en XUI_URL/XUI_API_KEY (env vars).
@Entity('xui_servidores')
@Index(['empresaId'], { unique: true })
export class XuiServidor extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ name: 'api_url', length: 300 })
  apiUrl: string;

  // Cifrado AES-256-GCM vía encryption.util.ts, igual que xui_lines.password
  @Column({ name: 'api_key', type: 'text' })
  apiKey: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  @Column({
    name: 'estado_conexion',
    type: 'enum',
    enum: ['ok', 'error', 'sin_probar'],
    enumName: 'xui_servidor_estado_conexion',
    default: 'sin_probar',
  })
  estadoConexion: XuiEstadoConexion;

  @Column({ name: 'ultimo_error_conexion', type: 'text', nullable: true })
  ultimoErrorConexion: string;

  @Column({ name: 'ultima_conexion_en', type: 'timestamptz', nullable: true })
  ultimaConexionEn: Date;

  // Snapshot traído al agregar/editar el servidor
  @Column({ name: 'total_lineas', type: 'int', default: 0 })
  totalLineas: number;

  @Column({ name: 'total_bouquets', type: 'int', default: 0 })
  totalBouquets: number;

  @Column({ name: 'total_canales', type: 'int', default: 0 })
  totalCanales: number;

  @Column({ name: 'catalogo_sincronizado_en', type: 'timestamptz', nullable: true })
  catalogoSincronizadoEn: Date;
}
