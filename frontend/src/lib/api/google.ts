import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';

// ─── Types ────────────────────────────────────────────────────

export interface GoogleStatus {
  appConfigured:     boolean;
  redirectUri:       string;
  connected:         boolean;
  email:             string | null;
  name:              string | null;
  picture:           string | null;
  scopes:            string[];
  services: {
    calendar: boolean;
    contacts: boolean;
    drive:    boolean;
    maps:     boolean;
  };
  lastSyncAt:        string | null;
  driveStorageUsed:  string;
  driveStorageTotal: string;
  errorCount:        number;
  lastError:         string | null;
}

export interface SaveAppConfigDto {
  clientId:     string;
  clientSecret: string;
  mapsApiKey?:  string;
}

export interface GoogleSyncLog {
  id:               string;
  empresaId:        string;
  service:          string;
  operation:        string;
  result:           'success' | 'failed' | 'partial' | 'skipped';
  recordsProcessed: number;
  recordsFailed:    number;
  details:          string | null;
  errorMessage:     string | null;
  durationMs:       number | null;
  triggeredBy:      string | null;
  referenceId:      string | null;
  createdAt:        string;
}

export interface GoogleCalendarEvent {
  id:          string;
  summary:     string;
  description: string;
  start:       { dateTime: string };
  end:         { dateTime: string };
  location:    string;
  htmlLink:    string;
}

export interface GoogleDriveFile {
  id:          string;
  name:        string;
  mimeType:    string;
  size:        string;
  createdTime: string;
  webViewLink: string;
}

export interface GeocodeResult {
  lat:              number;
  lng:              number;
  formattedAddress: string;
  placeId:          string;
  precisionGps:     number;
}

export interface UpdateServicesDto {
  calendarEnabled?: boolean;
  contactsEnabled?: boolean;
  driveEnabled?:    boolean;
  mapsEnabled?:     boolean;
}

export interface CreateCalendarEventDto {
  summary:       string;
  description?:  string;
  startDateTime: string;
  endDateTime:   string;
  location?:     string;
  colorId?:      string;
  clienteId?:    string;
  referenceId?:  string;
}

// ─── API client ───────────────────────────────────────────────

export const googleApi = {
  // ── App config ─────────────────────────────────────────
  saveAppConfig: async (empresaId: string, dto: SaveAppConfigDto): Promise<void> => {
    await api.post(`/google/${empresaId}/app-config`, dto);
  },

  // ── OAuth ──────────────────────────────────────────────
  getAuthUrl: async (empresaId: string): Promise<string> => {
    const res = await api.get<ApiRespuesta<{ url: string }>>(`/google/${empresaId}/auth/url`);
    return res.data.data.url;
  },

  disconnect: async (empresaId: string): Promise<void> => {
    await api.delete(`/google/${empresaId}/disconnect`);
  },

  // ── Status & logs ──────────────────────────────────────
  getStatus: async (empresaId: string): Promise<GoogleStatus> => {
    const res = await api.get<ApiRespuesta<GoogleStatus>>(`/google/${empresaId}/status`);
    return res.data.data;
  },

  getLogs: async (empresaId: string, limit = 20): Promise<GoogleSyncLog[]> => {
    const res = await api.get<ApiRespuesta<GoogleSyncLog[]>>(`/google/${empresaId}/logs`, {
      params: { limit },
    });
    return res.data.data;
  },

  // ── Services config ────────────────────────────────────
  updateServices: async (empresaId: string, dto: UpdateServicesDto): Promise<void> => {
    await api.post(`/google/${empresaId}/services`, dto);
  },

  // ── Calendar ───────────────────────────────────────────
  createCalendarEvent: async (
    empresaId: string,
    dto: CreateCalendarEventDto,
  ): Promise<{ eventId: string; htmlLink: string }> => {
    const res = await api.post<ApiRespuesta<{ eventId: string; htmlLink: string }>>(
      `/google/${empresaId}/calendar/events`, dto,
    );
    return res.data.data;
  },

  listCalendarEvents: async (empresaId: string, maxResults = 20): Promise<GoogleCalendarEvent[]> => {
    const res = await api.get<ApiRespuesta<GoogleCalendarEvent[]>>(
      `/google/${empresaId}/calendar/events`, { params: { maxResults } },
    );
    return res.data.data;
  },

  // ── Contacts ───────────────────────────────────────────
  syncContact: async (empresaId: string, clienteId: string): Promise<void> => {
    await api.post(`/google/${empresaId}/contacts/sync`, { clienteId });
  },

  syncContactsBulk: async (empresaId: string): Promise<void> => {
    await api.post(`/google/${empresaId}/contacts/sync-bulk`);
  },

  // ── Drive ──────────────────────────────────────────────
  listDriveFiles: async (empresaId: string): Promise<GoogleDriveFile[]> => {
    const res = await api.get<ApiRespuesta<GoogleDriveFile[]>>(`/google/${empresaId}/drive/files`);
    return res.data.data;
  },

  getDriveQuota: async (empresaId: string): Promise<{ used: string; total: string }> => {
    const res = await api.get<ApiRespuesta<{ used: string; total: string }>>(
      `/google/${empresaId}/drive/quota`,
    );
    return res.data.data;
  },

  // ── Maps ───────────────────────────────────────────────
  geocode: async (empresaId: string, address: string): Promise<GeocodeResult> => {
    const res = await api.post<ApiRespuesta<GeocodeResult>>(
      `/google/${empresaId}/maps/geocode`, { address },
    );
    return res.data.data;
  },

  geocodeQueue: async (
    empresaId: string,
    address: string,
    clienteId?: string,
    contratoId?: string,
  ): Promise<void> => {
    await api.post(`/google/${empresaId}/maps/geocode-queue`, { address, clienteId, contratoId });
  },
};
