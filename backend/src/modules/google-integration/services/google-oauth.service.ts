import {
  Injectable, Logger, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { google, Auth } from 'googleapis';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GoogleAccount, GoogleSyncStatus } from '../entities/google-account.entity';
import { GoogleSyncLog, GoogleSyncService, GoogleSyncResult } from '../entities/google-sync-log.entity';

export interface SaveAppConfigDto {
  clientId:     string;
  clientSecret: string;
  mapsApiKey?:  string;
}

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.send',
];

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GoogleAccount)
    private readonly accountRepo: Repository<GoogleAccount>,
    @InjectRepository(GoogleSyncLog)
    private readonly logRepo: Repository<GoogleSyncLog>,
  ) {
    const key = this.config.get<string>('GOOGLE_TOKEN_ENCRYPTION_KEY', '');
    // Derive 32-byte key from whatever secret is provided
    this.encryptionKey = crypto.createHash('sha256').update(key || 'default-insecure-key').digest();
  }

  // ── App-level config helpers ──────────────────────────────

  isAppConfigured(): boolean {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  getRedirectUri(): string {
    if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
    const base = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return `${base}/api/v1/google/auth/callback`;
  }

  async saveAppConfig(dto: SaveAppConfigDto): Promise<void> {
    const redirectUri = this.getRedirectUri();
    const encKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
      || crypto.randomBytes(32).toString('hex');

    // Apply to running process immediately (no restart required)
    process.env.GOOGLE_CLIENT_ID     = dto.clientId;
    process.env.GOOGLE_CLIENT_SECRET = dto.clientSecret;
    process.env.GOOGLE_REDIRECT_URI  = redirectUri;
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = encKey;
    if (dto.mapsApiKey) process.env.GOOGLE_MAPS_API_KEY = dto.mapsApiKey;

    // Re-derive the encryption key with the potentially new value
    const newKey = crypto.createHash('sha256').update(encKey).digest();
    (this as any).encryptionKey = newKey;

    // Persist to .env.production so the config survives a restart
    const envPath = path.resolve(process.cwd(), '.env.production');
    await this.upsertEnvFile(envPath, {
      GOOGLE_CLIENT_ID:            dto.clientId,
      GOOGLE_CLIENT_SECRET:        dto.clientSecret,
      GOOGLE_REDIRECT_URI:         redirectUri,
      GOOGLE_TOKEN_ENCRYPTION_KEY: encKey,
      ...(dto.mapsApiKey ? { GOOGLE_MAPS_API_KEY: dto.mapsApiKey } : {}),
    });

    this.logger.log('Google app credentials saved and applied');
  }

  private async upsertEnvFile(filePath: string, updates: Record<string, string>): Promise<void> {
    let content = '';
    try { content = await fs.readFile(filePath, 'utf-8'); } catch { /* new file */ }
    for (const [k, v] of Object.entries(updates)) {
      const re = new RegExp(`^${k}=.*$`, 'm');
      const line = `${k}=${v}`;
      content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
    }
    await fs.writeFile(filePath, content, 'utf-8');
  }

  // ── OAuth client factory ──────────────────────────────────
  createOAuth2Client(): Auth.OAuth2Client {
    // Read directly from process.env so runtime updates via saveAppConfig take effect immediately
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || this.getRedirectUri(),
    );
  }

  generateAuthUrl(empresaId: string): string {
    const client = this.createOAuth2Client();
    return client.generateAuthUrl({
      access_type:  'offline',
      scope:        SCOPES,
      state:        empresaId,
      prompt:       'consent',
      include_granted_scopes: true,
    });
  }

  async exchangeCodeForTokens(code: string, empresaId: string): Promise<GoogleAccount> {
    const client = this.createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Encrypt tokens
    const { encrypted, iv, authTag } = this.encrypt(JSON.stringify(tokens));

    // Upsert account
    let account = await this.accountRepo.findOne({ where: { empresaId } });
    if (!account) {
      account = this.accountRepo.create({ empresaId });
    }
    account.googleEmail    = userInfo.email!;
    account.googleName     = userInfo.name ?? '';
    account.googlePicture  = userInfo.picture ?? '';
    account.tokensEncrypted = encrypted;
    account.tokenIv         = iv;
    account.tokenAuthTag    = authTag;
    account.scopes          = SCOPES;
    account.status          = GoogleSyncStatus.CONNECTED;
    account.errorCount      = 0;
    account.lastError       = null;

    await this.accountRepo.save(account);
    await this.writeLog(empresaId, GoogleSyncService.OAUTH, 'connect', GoogleSyncResult.SUCCESS, 'Cuenta conectada', null, 'user');
    return account;
  }

  // ── Get authenticated client for an empresa ───────────────
  async getClient(empresaId: string): Promise<Auth.OAuth2Client> {
    const account = await this.getAccount(empresaId);
    const tokens  = JSON.parse(this.decrypt(account.tokensEncrypted, account.tokenIv, account.tokenAuthTag));

    const client = this.createOAuth2Client();
    client.setCredentials(tokens);

    // Auto-refresh if expired
    client.on('tokens', async (newTokens) => {
      const merged  = { ...tokens, ...newTokens };
      const { encrypted, iv, authTag } = this.encrypt(JSON.stringify(merged));
      await this.accountRepo.update(account.id, {
        tokensEncrypted: encrypted,
        tokenIv:         iv,
        tokenAuthTag:    authTag,
        status:          GoogleSyncStatus.CONNECTED,
        errorCount:      0,
      });
      this.logger.debug(`[${empresaId}] Tokens refrescados automáticamente`);
    });

    return client;
  }

  async getAccount(empresaId: string): Promise<GoogleAccount> {
    const account = await this.accountRepo.findOne({ where: { empresaId } });
    if (!account || account.status === GoogleSyncStatus.DISCONNECTED) {
      throw new NotFoundException('Cuenta Google no conectada');
    }
    return account;
  }

  async disconnect(empresaId: string): Promise<void> {
    const account = await this.accountRepo.findOne({ where: { empresaId } });
    if (!account) return;

    // Revoke token on Google
    try {
      const client = await this.getClient(empresaId);
      await client.revokeCredentials();
    } catch { /* ignore revocation errors */ }

    await this.accountRepo.update(account.id, {
      status:          GoogleSyncStatus.DISCONNECTED,
      tokensEncrypted: '',
      tokenIv:         '',
      tokenAuthTag:    '',
      scopes:          [],
    });
    await this.writeLog(empresaId, GoogleSyncService.OAUTH, 'disconnect', GoogleSyncResult.SUCCESS, 'Cuenta desconectada', null, 'user');
  }

  async getStatus(empresaId: string): Promise<{
    appConfigured: boolean;
    redirectUri:   string;
    connected: boolean;
    email: string | null;
    name: string | null;
    picture: string | null;
    scopes: string[];
    services: { calendar: boolean; contacts: boolean; drive: boolean; maps: boolean };
    lastSyncAt: Date | null;
    driveStorageUsed: string;
    driveStorageTotal: string;
    errorCount: number;
    lastError: string | null;
  }> {
    const appConfigured = this.isAppConfigured();
    const redirectUri   = this.getRedirectUri();
    const account = await this.accountRepo.findOne({ where: { empresaId } });
    if (!account || account.status !== GoogleSyncStatus.CONNECTED) {
      return {
        appConfigured, redirectUri,
        connected: false, email: null, name: null, picture: null, scopes: [],
        services: { calendar: false, contacts: false, drive: false, maps: false },
        lastSyncAt: null, driveStorageUsed: '0', driveStorageTotal: '0',
        errorCount: 0, lastError: null,
      };
    }
    return {
      appConfigured, redirectUri,
      connected:         true,
      email:             account.googleEmail,
      name:              account.googleName,
      picture:           account.googlePicture,
      scopes:            account.scopes,
      services: {
        calendar: account.calendarEnabled,
        contacts: account.contactsEnabled,
        drive:    account.driveEnabled,
        maps:     account.mapsEnabled,
      },
      lastSyncAt:        account.lastSyncAt,
      driveStorageUsed:  account.driveStorageUsed,
      driveStorageTotal: account.driveStorageTotal,
      errorCount:        account.errorCount,
      lastError:         account.lastError,
    };
  }

  async updateServices(empresaId: string, dto: Partial<GoogleAccount>): Promise<void> {
    const account = await this.getAccount(empresaId);
    await this.accountRepo.update(account.id, dto);
  }

  async markError(empresaId: string, error: string): Promise<void> {
    await this.accountRepo
      .createQueryBuilder()
      .update()
      .set({
        lastError:  error.substring(0, 500),
        errorCount: () => 'error_count + 1',
        status:     GoogleSyncStatus.CONNECTED,
      })
      .where('empresa_id = :empresaId', { empresaId })
      .execute();
  }

  async updateLastSync(empresaId: string, service?: 'contacts' | 'calendar' | 'drive'): Promise<void> {
    const now = new Date();
    const fields: Partial<GoogleAccount> = { lastSyncAt: now };
    if (service === 'contacts') fields.lastContactsSyncAt = now;
    if (service === 'calendar') fields.lastCalendarSyncAt = now;
    if (service === 'drive')    fields.lastDriveSyncAt    = now;
    await this.accountRepo.update({ empresaId }, fields as any);
  }

  // ── Logs ──────────────────────────────────────────────────
  async writeLog(
    empresaId: string,
    service: GoogleSyncService,
    operation: string,
    result: GoogleSyncResult,
    details?: string,
    error?: string,
    triggeredBy?: string,
    referenceId?: string,
    durationMs?: number,
    recordsProcessed = 0,
    recordsFailed = 0,
  ): Promise<void> {
    const log = this.logRepo.create({
      empresaId, service, operation, result,
      details, errorMessage: error, triggeredBy, referenceId,
      durationMs, recordsProcessed, recordsFailed,
    });
    await this.logRepo.save(log).catch((e) => this.logger.warn('Log write failed', e));
  }

  async getLogs(empresaId: string, limit = 20): Promise<GoogleSyncLog[]> {
    return this.logRepo.find({
      where:  { empresaId },
      order:  { createdAt: 'DESC' },
      take:   limit,
    });
  }

  // ── Encryption helpers ────────────────────────────────────
  private encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = (cipher as any).getAuthTag().toString('hex');
    return { encrypted, iv: iv.toString('hex'), authTag };
  }

  private decrypt(encrypted: string, ivHex: string, authTagHex: string): string {
    const iv      = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.ALGORITHM, this.encryptionKey, iv);
    (decipher as any).setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
