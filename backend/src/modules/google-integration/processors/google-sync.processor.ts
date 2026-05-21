import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { GoogleOAuthService }     from '../services/google-oauth.service';
import { GoogleCalendarService }  from '../services/google-calendar.service';
import { GoogleContactsService }  from '../services/google-contacts.service';
import { GoogleDriveService }     from '../services/google-drive.service';
import { GoogleMapsService }      from '../services/google-maps.service';
import { QUEUES, JOBS } from '../../workers/workers.constants';

// ─── Job payloads ─────────────────────────────────────────────
export interface PayloadSyncContact {
  empresaId:  string;
  clienteId:  string;
  triggered?: string;
}

export interface PayloadSyncContactsBulk {
  empresaId: string;
  limit?:    number;
}

export interface PayloadCalendarEvent {
  empresaId:     string;
  summary:       string;
  description?:  string;
  startDateTime: string;
  endDateTime:   string;
  location?:     string;
  colorId?:      string;
  referenceId?:  string;
  clienteId?:    string;
}

export interface PayloadDriveBackup {
  empresaId: string;
  backupId:  string;
  fileName:  string;
  mimeType:  string;
  content:   string; // base64
}

export interface PayloadGeocodeAddress {
  empresaId:   string;
  address:     string;
  clienteId?:  string;
  contratoId?: string;
}

// ─────────────────────────────────────────────────────────────
@Processor(QUEUES.GOOGLE_SYNC)
export class GoogleSyncProcessor {
  private readonly logger = new Logger(GoogleSyncProcessor.name);

  constructor(
    private readonly oauthSvc:    GoogleOAuthService,
    private readonly calendarSvc: GoogleCalendarService,
    private readonly contactsSvc: GoogleContactsService,
    private readonly driveSvc:    GoogleDriveService,
    private readonly mapsSvc:     GoogleMapsService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Sync single contact ───────────────────────────────────
  @Process(JOBS.GOOGLE_SYNC_CONTACT)
  async handleSyncContact(job: Job<PayloadSyncContact>) {
    const { empresaId, clienteId } = job.data;
    this.logger.debug(`[${empresaId}] Syncing contact ${clienteId}`);

    const [cliente] = await this.ds.query(
      `SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [clienteId, empresaId],
    );
    if (!cliente) return;

    const googleContactId = await this.getGoogleContactId(clienteId);

    await this.contactsSvc.upsertContact(empresaId, {
      clienteId,
      nombres:          cliente.nombres,
      apellidoPaterno:  cliente.apellido_paterno,
      apellidoMaterno:  cliente.apellido_materno,
      email:            cliente.email,
      telefono:         cliente.telefono,
      telefonoAlt:      cliente.telefono_alt,
      direccion:        cliente.direccion,
      distrito:         cliente.distrito,
      provincia:        cliente.provincia,
      notas:            cliente.notas_internas,
      googleContactId,
    });
  }

  // ── Bulk contacts sync ────────────────────────────────────
  @Process(JOBS.GOOGLE_SYNC_CONTACTS_BULK)
  async handleSyncContactsBulk(job: Job<PayloadSyncContactsBulk>) {
    const { empresaId, limit = 200 } = job.data;
    this.logger.debug(`[${empresaId}] Bulk contact sync (limit: ${limit})`);

    const clientes = await this.ds.query(
      `SELECT * FROM clientes WHERE empresa_id = $1 AND deleted_at IS NULL
       AND estado NOT IN ('baja_definitiva') ORDER BY created_at DESC LIMIT $2`,
      [empresaId, limit],
    );

    const contacts = clientes.map((c: any) => ({
      clienteId:       c.id,
      nombres:         c.nombres,
      apellidoPaterno: c.apellido_paterno,
      apellidoMaterno: c.apellido_materno,
      email:           c.email,
      telefono:        c.telefono,
      telefonoAlt:     c.telefono_alt,
      direccion:       c.direccion,
      distrito:        c.distrito,
      provincia:       c.provincia,
    }));

    await this.contactsSvc.syncBulk(empresaId, contacts);
  }

  // ── Calendar event ────────────────────────────────────────
  @Process(JOBS.GOOGLE_CALENDAR_EVENT)
  async handleCalendarEvent(job: Job<PayloadCalendarEvent>) {
    const { empresaId, ...input } = job.data;
    this.logger.debug(`[${empresaId}] Creating calendar event: ${input.summary}`);
    await this.calendarSvc.createEvent(empresaId, input);
  }

  // ── Drive backup upload ───────────────────────────────────
  @Process(JOBS.GOOGLE_DRIVE_BACKUP)
  async handleDriveBackup(job: Job<PayloadDriveBackup>) {
    const { empresaId, fileName, mimeType, content, backupId } = job.data;
    this.logger.debug(`[${empresaId}] Uploading backup ${fileName} to Drive`);

    const buffer = Buffer.from(content, 'base64');
    await this.driveSvc.uploadFile(empresaId, {
      fileName,
      mimeType,
      content:     buffer,
      description: `Backup DataFast CRM — ${new Date().toISOString()}`,
    });

    // Mark backup as uploaded in drive
    await this.ds.query(
      `UPDATE backups SET drive_uploaded = true, drive_uploaded_at = NOW() WHERE id = $1`,
      [backupId],
    ).catch(() => undefined); // tabla backup puede no tener estas columnas aún
  }

  // ── Geocode address ───────────────────────────────────────
  @Process(JOBS.GOOGLE_GEOCODE_ADDRESS)
  async handleGeocodeAddress(job: Job<PayloadGeocodeAddress>) {
    const { empresaId, address, clienteId, contratoId } = job.data;
    this.logger.debug(`[${empresaId}] Geocoding: ${address}`);

    const result = await this.mapsSvc.geocode(empresaId, address);

    if (clienteId) {
      await this.ds.query(
        `UPDATE clientes SET latitud = $1, longitud = $2, precision_gps = $3
         WHERE id = $4 AND empresa_id = $5`,
        [result.lat, result.lng, result.precisionGps, clienteId, empresaId],
      );
    }

    if (contratoId) {
      await this.ds.query(
        `UPDATE contratos SET latitud_instalacion = $1, longitud_instalacion = $2
         WHERE id = $3 AND empresa_id = $4`,
        [result.lat, result.lng, contratoId, empresaId],
      );
    }
  }

  // ── Queue event hooks ─────────────────────────────────────
  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`[GOOGLE_SYNC] Job ${job.name} #${job.id} fallido: ${err.message}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`[GOOGLE_SYNC] Job ${job.name} #${job.id} completado`);
  }

  // ── Private helpers ───────────────────────────────────────
  private async getGoogleContactId(clienteId: string): Promise<string | undefined> {
    const [row] = await this.ds.query(
      `SELECT google_contact_id FROM google_client_contacts WHERE cliente_id = $1 LIMIT 1`,
      [clienteId],
    ).catch(() => [undefined]);
    return row?.google_contact_id;
  }
}
