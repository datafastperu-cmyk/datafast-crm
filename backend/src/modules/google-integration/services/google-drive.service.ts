import { Injectable, Logger } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleSyncService, GoogleSyncResult } from '../entities/google-sync-log.entity';

export interface DriveUploadInput {
  fileName:    string;
  mimeType:    string;
  content:     Buffer | string;
  folderId?:   string;
  description?: string;
}

export interface DriveFileResult {
  fileId:   string;
  name:     string;
  webViewLink: string;
  size:     string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_FOLDER_NAME = 'DataFast CRM';

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(private readonly oauthSvc: GoogleOAuthService) {}

  async uploadFile(empresaId: string, input: DriveUploadInput): Promise<DriveFileResult> {
    const start = Date.now();
    try {
      const auth  = await this.oauthSvc.getClient(empresaId);
      const drive = google.drive({ version: 'v3', auth });

      const folderId = input.folderId ?? await this.ensureRootFolder(empresaId, drive);

      const stream = Readable.from(
        typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content,
      );

      const res = await drive.files.create({
        requestBody: {
          name:        input.fileName,
          description: input.description,
          parents:     [folderId],
        },
        media:  { mimeType: input.mimeType, body: stream },
        fields: 'id,name,webViewLink,size',
      });

      await this.oauthSvc.updateLastSync(empresaId, 'drive');
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.DRIVE, 'upload_file', GoogleSyncResult.SUCCESS,
        `Archivo: ${input.fileName}`, undefined, 'system', res.data.id,
        Date.now() - start, 1, 0,
      );

      return {
        fileId:      res.data.id!,
        name:        res.data.name!,
        webViewLink: res.data.webViewLink ?? '',
        size:        res.data.size ?? '0',
      };
    } catch (err: any) {
      await this.oauthSvc.markError(empresaId, err.message);
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.DRIVE, 'upload_file', GoogleSyncResult.FAILED,
        undefined, err.message, 'system', undefined, Date.now() - start, 0, 1,
      );
      throw err;
    }
  }

  async createFolder(empresaId: string, name: string, parentId?: string): Promise<string> {
    const auth  = await this.oauthSvc.getClient(empresaId);
    const drive = google.drive({ version: 'v3', auth });

    const existing = await this.findFolder(drive, name, parentId);
    if (existing) return existing;

    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents:  parentId ? [parentId] : undefined,
      },
      fields: 'id',
    });

    return res.data.id!;
  }

  async listFiles(empresaId: string, folderId?: string, pageSize = 20): Promise<drive_v3.Schema$File[]> {
    const auth  = await this.oauthSvc.getClient(empresaId);
    const drive = google.drive({ version: 'v3', auth });

    const q = folderId
      ? `'${folderId}' in parents and trashed = false`
      : `'root' in parents and trashed = false`;

    const res = await drive.files.list({
      q,
      pageSize,
      fields: 'files(id,name,mimeType,size,createdTime,webViewLink)',
      orderBy: 'createdTime desc',
    });

    return res.data.files ?? [];
  }

  async deleteFile(empresaId: string, fileId: string): Promise<void> {
    try {
      const auth  = await this.oauthSvc.getClient(empresaId);
      const drive = google.drive({ version: 'v3', auth });
      await drive.files.delete({ fileId });
    } catch (err: any) {
      this.logger.warn(`[${empresaId}] No se pudo eliminar archivo ${fileId}: ${err.message}`);
    }
  }

  async getStorageQuota(empresaId: string): Promise<{ used: string; total: string }> {
    const auth  = await this.oauthSvc.getClient(empresaId);
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.about.get({ fields: 'storageQuota' });
    const quota = res.data.storageQuota ?? {};
    const used  = quota.usage ?? '0';
    const total = quota.limit ?? '0';

    await this.oauthSvc.updateServices(empresaId, {
      driveStorageUsed:  used,
      driveStorageTotal: total,
    } as any);

    return { used, total };
  }

  // ── Helpers ───────────────────────────────────────────────
  private async ensureRootFolder(empresaId: string, drive: drive_v3.Drive): Promise<string> {
    const account = await this.oauthSvc.getAccount(empresaId);
    if (account.driveRootFolderId) return account.driveRootFolderId;

    const existing = await this.findFolder(drive, ROOT_FOLDER_NAME);
    const folderId = existing ?? (await this.createFolderRaw(drive, ROOT_FOLDER_NAME));

    await this.oauthSvc.updateServices(empresaId, { driveRootFolderId: folderId } as any);
    return folderId;
  }

  private async findFolder(drive: drive_v3.Drive, name: string, parentId?: string): Promise<string | null> {
    const q = parentId
      ? `mimeType='${FOLDER_MIME}' and name='${name}' and '${parentId}' in parents and trashed=false`
      : `mimeType='${FOLDER_MIME}' and name='${name}' and trashed=false`;

    const res = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
    return res.data.files?.[0]?.id ?? null;
  }

  private async createFolderRaw(drive: drive_v3.Drive, name: string, parentId?: string): Promise<string> {
    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents:  parentId ? [parentId] : undefined,
      },
      fields: 'id',
    });
    return res.data.id!;
  }
}
