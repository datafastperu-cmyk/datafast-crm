import { Injectable, Logger } from '@nestjs/common';
import { google, people_v1 } from 'googleapis';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleSyncService, GoogleSyncResult } from '../entities/google-sync-log.entity';

export interface ContactInput {
  clienteId:        string;
  nombreCompleto:   string;
  email?:           string;
  telefono?:       string;
  telefonoAlt?:    string;
  direccion?:      string;
  distrito?:       string;
  provincia?:      string;
  notas?:          string;
  googleContactId?: string;
}

export interface ContactResult {
  resourceName: string;
  etag:         string;
  displayName:  string;
}

@Injectable()
export class GoogleContactsService {
  private readonly logger = new Logger(GoogleContactsService.name);

  constructor(private readonly oauthSvc: GoogleOAuthService) {}

  async upsertContact(empresaId: string, input: ContactInput): Promise<ContactResult> {
    const start = Date.now();
    try {
      const auth    = await this.oauthSvc.getClient(empresaId);
      const people  = google.people({ version: 'v1', auth });

      const body = this.buildPersonBody(input);
      let result: people_v1.Schema$Person;

      if (input.googleContactId) {
        // Update existing
        const existing = await people.people.get({
          resourceName: input.googleContactId,
          personFields: 'names,emailAddresses,phoneNumbers,addresses,biographies,etag',
        });
        result = (await people.people.updateContact({
          resourceName: input.googleContactId,
          updatePersonFields: 'names,emailAddresses,phoneNumbers,addresses,biographies',
          requestBody: { ...body, etag: existing.data.etag },
        })).data;
      } else {
        result = (await people.people.createContact({ requestBody: body })).data;
      }

      await this.oauthSvc.updateLastSync(empresaId, 'contacts');
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.CONTACTS,
        input.googleContactId ? 'update_contact' : 'create_contact',
        GoogleSyncResult.SUCCESS,
        input.nombreCompleto, undefined, 'system', input.clienteId,
        Date.now() - start, 1, 0,
      );

      return {
        resourceName: result.resourceName!,
        etag:         result.etag!,
        displayName:  result.names?.[0]?.displayName ?? input.nombreCompleto,
      };
    } catch (err: any) {
      await this.oauthSvc.markError(empresaId, err.message);
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.CONTACTS, 'upsert_contact', GoogleSyncResult.FAILED,
        undefined, err.message, 'system', input.clienteId, Date.now() - start, 0, 1,
      );
      throw err;
    }
  }

  async deleteContact(empresaId: string, googleContactId: string): Promise<void> {
    try {
      const auth   = await this.oauthSvc.getClient(empresaId);
      const people = google.people({ version: 'v1', auth });
      await people.people.deleteContact({ resourceName: googleContactId });
    } catch (err: any) {
      this.logger.warn(`[${empresaId}] No se pudo eliminar contacto ${googleContactId}: ${err.message}`);
    }
  }

  async searchContact(empresaId: string, query: string): Promise<people_v1.Schema$Person[]> {
    const auth   = await this.oauthSvc.getClient(empresaId);
    const people = google.people({ version: 'v1', auth });

    const res = await people.people.searchContacts({
      query,
      readMask: 'names,emailAddresses,phoneNumbers,userDefined',
      pageSize: 10,
    });

    return res.data.results?.map((r) => r.person ?? {}) ?? [];
  }

  async syncBulk(empresaId: string, contacts: ContactInput[]): Promise<{ ok: number; failed: number }> {
    const start = Date.now();
    let ok = 0, failed = 0;

    for (const c of contacts) {
      try {
        await this.upsertContact(empresaId, c);
        ok++;
      } catch {
        failed++;
      }
    }

    await this.oauthSvc.writeLog(
      empresaId, GoogleSyncService.CONTACTS, 'bulk_sync', GoogleSyncResult.SUCCESS,
      `${ok} ok, ${failed} fallidos`, undefined, 'scheduler', undefined,
      Date.now() - start, ok, failed,
    );

    return { ok, failed };
  }

  // ── Helpers ───────────────────────────────────────────────
  private buildPersonBody(input: ContactInput): people_v1.Schema$Person {
    const body: people_v1.Schema$Person = {
      names: [{
        displayName: input.nombreCompleto,
        givenName:   input.nombreCompleto,
      }],
      memberships: [{
        contactGroupMembership: { contactGroupResourceName: 'contactGroups/myContacts' },
      }],
    };

    if (input.email) {
      body.emailAddresses = [{ value: input.email, type: 'work' }];
    }

    const phones: people_v1.Schema$PhoneNumber[] = [];
    if (input.telefono)    phones.push({ value: input.telefono,    type: 'mobile' });
    if (input.telefonoAlt) phones.push({ value: input.telefonoAlt, type: 'home' });
    if (phones.length)     body.phoneNumbers = phones;

    if (input.direccion) {
      body.addresses = [{
        streetAddress: input.direccion,
        city:          input.distrito,
        region:        input.provincia,
        countryCode:   'PE',
        type:          'home',
      }];
    }

    const bioLines: string[] = [`Cliente DataFast CRM | ID: ${input.clienteId}`];
    if (input.notas) bioLines.push(input.notas);
    body.biographies = [{ value: bioLines.join('\n'), contentType: 'TEXT_PLAIN' }];

    body.userDefined = [{ key: 'datafast_cliente_id', value: input.clienteId }];

    return body;
  }
}
