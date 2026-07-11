import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum EstadoSyncXuiLine {
  PENDIENTE_CREACION   = 'pendiente_creacion',
  SINCRONIZADO         = 'sincronizado',
  PENDIENTE_ELIMINACION = 'pendiente_eliminacion',
  ERROR                = 'error',
}

// Un line por servicio/contrato con IPTV habilitado — no por cliente.
// Un cliente con dos servicios IPTV tiene dos filas, una por contratoId.
@Entity('xui_lines')
@Index(['empresaId', 'clienteId'])
export class XuiLine extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  // ID externo en XUI — nulo hasta que la creación se confirme
  @Column({ name: 'xui_line_id', nullable: true })
  xuiLineId: string;

  @Column({ length: 60 })
  usuario: string;

  // Cifrado AES-256-GCM vía encryption.util.ts, igual que contrato.passwordPppoe
  @Column({ length: 500 })
  password: string;

  // 1 = sin sufijo (usuario = DNI), 2 = DNI2, 3 = DNI3...
  @Column({ type: 'smallint', default: 1 })
  sufijo: number;

  @Column({ name: 'bouquet_ids', type: 'jsonb', default: () => "'[]'" })
  bouquetIds: number[];

  @Column({ name: 'max_conexiones', type: 'smallint', default: 1 })
  maxConexiones: number;

  @Column({ default: true })
  activo: boolean;

  // ── Máquina de estados de sincronización con XUI ────────────
  @Column({
    name: 'estado_sync',
    type: 'enum',
    enum: EstadoSyncXuiLine,
    enumName: 'xui_line_estado_sync',
    default: EstadoSyncXuiLine.PENDIENTE_CREACION,
  })
  estadoSync: EstadoSyncXuiLine;

  @Column({ name: 'intentos_sync', type: 'smallint', default: 0 })
  intentosSync: number;

  @Column({ name: 'ultimo_error_sync', type: 'text', nullable: true })
  ultimoErrorSync: string;

  @Column({ name: 'sincronizado_en', type: 'timestamptz', nullable: true })
  sincronizadoEn: Date;

  // ── Caché de estado en vivo (actualizada por el poller) ─────
  @Column({ name: 'canal_actual', type: 'text', nullable: true })
  canalActual: string;

  @Column({ default: false })
  conectado: boolean;

  @Column({ name: 'ultima_actividad_en', type: 'timestamptz', nullable: true })
  ultimaActividadEn: Date;
}
