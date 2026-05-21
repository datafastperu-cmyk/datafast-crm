import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum GoogleSyncService {
  CONTACTS = 'contacts',
  CALENDAR = 'calendar',
  DRIVE    = 'drive',
  MAPS     = 'maps',
  OAUTH    = 'oauth',
}

export enum GoogleSyncResult {
  SUCCESS = 'success',
  FAILED  = 'failed',
  PARTIAL = 'partial',
  SKIPPED = 'skipped',
}

@Entity('google_sync_logs')
@Index(['empresaId', 'createdAt'])
@Index(['empresaId', 'service'])
export class GoogleSyncLog extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'service', type: 'enum', enum: GoogleSyncService })
  service: GoogleSyncService;

  @Column({ name: 'operation', length: 100 })
  operation: string;

  @Column({ name: 'result', type: 'enum', enum: GoogleSyncResult })
  result: GoogleSyncResult;

  @Column({ name: 'records_processed', default: 0 })
  recordsProcessed: number;

  @Column({ name: 'records_failed', default: 0 })
  recordsFailed: number;

  @Column({ name: 'details', type: 'text', nullable: true })
  details: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number;

  @Column({ name: 'triggered_by', length: 50, nullable: true })
  triggeredBy: string;

  @Column({ name: 'reference_id', nullable: true })
  referenceId: string;
}
