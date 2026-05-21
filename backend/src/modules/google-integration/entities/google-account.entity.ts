import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum GoogleSyncStatus {
  CONNECTED    = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR        = 'error',
  REFRESHING   = 'refreshing',
}

@Entity('google_accounts')
@Index(['empresaId'], { unique: true })
export class GoogleAccount extends BaseModel {
  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'google_email', length: 200 })
  googleEmail: string;

  @Column({ name: 'google_name', length: 200, nullable: true })
  googleName: string;

  @Column({ name: 'google_picture', length: 500, nullable: true })
  googlePicture: string;

  /** AES-256-GCM encrypted JSON: { access_token, refresh_token, expiry_date } */
  @Column({ name: 'tokens_encrypted', type: 'text' })
  tokensEncrypted: string;

  @Column({ name: 'token_iv', length: 64 })
  tokenIv: string;

  @Column({ name: 'token_auth_tag', length: 64 })
  tokenAuthTag: string;

  @Column({ name: 'scopes', type: 'text', array: true, default: '{}' })
  scopes: string[];

  @Column({ name: 'status', type: 'enum', enum: GoogleSyncStatus, default: GoogleSyncStatus.CONNECTED })
  status: GoogleSyncStatus;

  // ── Configuración de servicios ─────────────────────────────
  @Column({ name: 'calendar_enabled', default: true })
  calendarEnabled: boolean;

  @Column({ name: 'contacts_enabled', default: true })
  contactsEnabled: boolean;

  @Column({ name: 'drive_enabled', default: true })
  driveEnabled: boolean;

  @Column({ name: 'maps_enabled', default: true })
  mapsEnabled: boolean;

  // ── Timestamps de sync ────────────────────────────────────
  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true })
  lastSyncAt: Date;

  @Column({ name: 'last_contacts_sync_at', type: 'timestamptz', nullable: true })
  lastContactsSyncAt: Date;

  @Column({ name: 'last_calendar_sync_at', type: 'timestamptz', nullable: true })
  lastCalendarSyncAt: Date;

  @Column({ name: 'last_drive_sync_at', type: 'timestamptz', nullable: true })
  lastDriveSyncAt: Date;

  // ── Drive metadata ────────────────────────────────────────
  @Column({ name: 'drive_root_folder_id', length: 100, nullable: true })
  driveRootFolderId: string;

  @Column({ name: 'drive_storage_used', type: 'bigint', default: 0 })
  driveStorageUsed: string;

  @Column({ name: 'drive_storage_total', type: 'bigint', default: 0 })
  driveStorageTotal: string;

  // ── Error tracking ────────────────────────────────────────
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string;

  @Column({ name: 'error_count', default: 0 })
  errorCount: number;
}
