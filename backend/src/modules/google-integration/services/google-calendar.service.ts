import { Injectable, Logger } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleSyncService, GoogleSyncResult } from '../entities/google-sync-log.entity';

export interface CalendarEventInput {
  summary:       string;
  description?:  string;
  startDateTime: string; // ISO 8601
  endDateTime:   string;
  location?:     string;
  colorId?:      string;
  referenceId?:  string;
  clienteId?:    string;
}

export interface CalendarEventResult {
  eventId:   string;
  htmlLink:  string;
  summary:   string;
  startDateTime: string;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(private readonly oauthSvc: GoogleOAuthService) {}

  async createEvent(empresaId: string, input: CalendarEventInput): Promise<CalendarEventResult> {
    const start = Date.now();
    try {
      const auth = await this.oauthSvc.getClient(empresaId);
      const cal  = google.calendar({ version: 'v3', auth });

      const event: calendar_v3.Schema$Event = {
        summary:     input.summary,
        description: this.buildDescription(input),
        start:       { dateTime: input.startDateTime, timeZone: 'America/Lima' },
        end:         { dateTime: input.endDateTime,   timeZone: 'America/Lima' },
        location:    input.location,
        colorId:     input.colorId ?? '1',
        extendedProperties: {
          private: {
            source:     'datafast-crm',
            clienteId:  input.clienteId  ?? '',
            referenceId: input.referenceId ?? '',
          },
        },
      };

      const res = await cal.events.insert({ calendarId: 'primary', requestBody: event });

      await this.oauthSvc.updateLastSync(empresaId, 'calendar');
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.CALENDAR, 'create_event', GoogleSyncResult.SUCCESS,
        `Evento: ${input.summary}`, undefined, 'system', input.referenceId,
        Date.now() - start, 1, 0,
      );

      return {
        eventId:       res.data.id!,
        htmlLink:      res.data.htmlLink!,
        summary:       res.data.summary!,
        startDateTime: res.data.start?.dateTime ?? input.startDateTime,
      };
    } catch (err: any) {
      await this.oauthSvc.markError(empresaId, err.message);
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.CALENDAR, 'create_event', GoogleSyncResult.FAILED,
        `Error creando evento: ${input.summary}`, err.message, 'system', input.referenceId,
        Date.now() - start, 0, 1,
      );
      throw err;
    }
  }

  async updateEvent(empresaId: string, eventId: string, patch: Partial<CalendarEventInput>): Promise<void> {
    const start = Date.now();
    try {
      const auth = await this.oauthSvc.getClient(empresaId);
      const cal  = google.calendar({ version: 'v3', auth });

      const update: calendar_v3.Schema$Event = {};
      if (patch.summary)       update.summary     = patch.summary;
      if (patch.description)   update.description = patch.description;
      if (patch.location)      update.location    = patch.location;
      if (patch.startDateTime) update.start       = { dateTime: patch.startDateTime, timeZone: 'America/Lima' };
      if (patch.endDateTime)   update.end         = { dateTime: patch.endDateTime,   timeZone: 'America/Lima' };

      await cal.events.patch({ calendarId: 'primary', eventId, requestBody: update });

      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.CALENDAR, 'update_event', GoogleSyncResult.SUCCESS,
        `Evento actualizado: ${eventId}`, undefined, 'system', eventId, Date.now() - start, 1, 0,
      );
    } catch (err: any) {
      await this.oauthSvc.markError(empresaId, err.message);
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.CALENDAR, 'update_event', GoogleSyncResult.FAILED,
        undefined, err.message, 'system', eventId, Date.now() - start, 0, 1,
      );
      throw err;
    }
  }

  async deleteEvent(empresaId: string, eventId: string): Promise<void> {
    try {
      const auth = await this.oauthSvc.getClient(empresaId);
      const cal  = google.calendar({ version: 'v3', auth });
      await cal.events.delete({ calendarId: 'primary', eventId });
    } catch (err: any) {
      this.logger.warn(`[${empresaId}] No se pudo eliminar evento ${eventId}: ${err.message}`);
    }
  }

  async listUpcomingEvents(empresaId: string, maxResults = 20): Promise<calendar_v3.Schema$Event[]> {
    const auth = await this.oauthSvc.getClient(empresaId);
    const cal  = google.calendar({ version: 'v3', auth });

    const res = await cal.events.list({
      calendarId:   'primary',
      timeMin:      new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy:      'startTime',
    });

    return res.data.items ?? [];
  }

  // ── Helpers ───────────────────────────────────────────────
  private buildDescription(input: CalendarEventInput): string {
    const parts: string[] = [];
    if (input.description) parts.push(input.description);
    if (input.clienteId)   parts.push(`Cliente ID: ${input.clienteId}`);
    if (input.referenceId) parts.push(`Referencia: ${input.referenceId}`);
    parts.push('Generado automáticamente por DataFast CRM');
    return parts.join('\n');
  }
}
