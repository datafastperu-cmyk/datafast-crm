import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Historial de métricas ópticas por ONU — base para gráficas de señal.
// BIGSERIAL: crece ~12 filas/ONU/hora con cron cada 5 min.
// Sin deleted_at — tabla de serie temporal; no se elimina, se expira por partición.
@Entity('metricas_onu_optical')
@Index('idx_mou_onu_ts',     ['onuId',            'timestamp'])
@Index('idx_mou_empresa_ts', ['empresaId',         'timestamp'])
@Index('idx_mou_olt_ts',     ['oltDispositivoId',  'timestamp'])
export class MetricasOnuOptical {

  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'onu_id' })
  onuId: string;

  @Column({ name: 'olt_dispositivo_id' })
  oltDispositivoId: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'rx_power_dbm', type: 'decimal', precision: 6, scale: 2, nullable: true })
  rxPowerDbm: number | null;

  @Column({ name: 'tx_power_dbm', type: 'decimal', precision: 6, scale: 2, nullable: true })
  txPowerDbm: number | null;

  @Column({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true })
  temperaturaC: number | null;

  @Column({ type: 'timestamptz' })
  timestamp: Date;
}
