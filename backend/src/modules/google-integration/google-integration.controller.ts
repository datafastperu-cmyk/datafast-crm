import {
  Controller, Get, Post, Delete, Body, Param, Query, Redirect,
  HttpCode, HttpStatus, Logger, Res,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
  ApiParam, ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

import { GoogleOAuthService }    from './services/google-oauth.service';
import { GoogleCalendarService } from './services/google-calendar.service';
import { GoogleDriveService }    from './services/google-drive.service';
import { GoogleMapsService }     from './services/google-maps.service';

import {
  UpdateGoogleServicesDto,
  GeocodeDto,
  GoogleCalendarEventDto,
  SyncContactDto,
} from './dto/google-integration.dto';
import { QUEUES, JOBS } from '../workers/workers.constants';

@ApiTags('Google Integration')
@ApiBearerAuth('JWT')
@Controller('google')
export class GoogleIntegrationController {
  private readonly logger = new Logger(GoogleIntegrationController.name);

  constructor(
    private readonly oauthSvc:     GoogleOAuthService,
    private readonly calendarSvc:  GoogleCalendarService,
    private readonly driveSvc:     GoogleDriveService,
    private readonly mapsSvc:      GoogleMapsService,
    @InjectQueue(QUEUES.GOOGLE_SYNC) private readonly googleQueue: Queue,
  ) {}

  // ── OAuth flow ────────────────────────────────────────────

  @Get(':empresaId/auth/url')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Obtener URL de autorización Google OAuth2' })
  getAuthUrl(@Param('empresaId') empresaId: string) {
    const url = this.oauthSvc.generateAuthUrl(empresaId);
    return StdResponse.ok({ url }, 'URL generada');
  }

  @Get('auth/callback')
  @ApiOperation({ summary: 'Callback OAuth2 de Google — redirige al frontend' })
  async handleCallback(
    @Query('code')  code:  string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    if (error) {
      return res.redirect(`${frontendUrl}/configuracion/integraciones/google?error=${encodeURIComponent(error)}`);
    }

    try {
      await this.oauthSvc.exchangeCodeForTokens(code, state);
      return res.redirect(`${frontendUrl}/configuracion/integraciones/google?connected=1`);
    } catch (err: any) {
      this.logger.error(`OAuth callback error: ${err.message}`);
      return res.redirect(
        `${frontendUrl}/configuracion/integraciones/google?error=${encodeURIComponent(err.message)}`,
      );
    }
  }

  @Delete(':empresaId/disconnect')
  @RequirePermission('configuracion:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desconectar cuenta Google' })
  async disconnect(@Param('empresaId') empresaId: string) {
    await this.oauthSvc.disconnect(empresaId);
  }

  // ── Status ────────────────────────────────────────────────

  @Get(':empresaId/status')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Estado de la integración Google' })
  async getStatus(@Param('empresaId') empresaId: string) {
    const status = await this.oauthSvc.getStatus(empresaId);
    return StdResponse.ok(status);
  }

  @Get(':empresaId/logs')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Logs de sincronización Google' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getLogs(
    @Param('empresaId') empresaId: string,
    @Query('limit') limit = 20,
  ) {
    const logs = await this.oauthSvc.getLogs(empresaId, +limit);
    return StdResponse.ok(logs);
  }

  // ── Services config ───────────────────────────────────────

  @Post(':empresaId/services')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Actualizar servicios habilitados' })
  async updateServices(
    @Param('empresaId') empresaId: string,
    @Body() dto: UpdateGoogleServicesDto,
  ) {
    await this.oauthSvc.updateServices(empresaId, dto as any);
    return StdResponse.ok(null, 'Configuración actualizada');
  }

  // ── Calendar ──────────────────────────────────────────────

  @Post(':empresaId/calendar/events')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Crear evento en Google Calendar' })
  async createCalendarEvent(
    @Param('empresaId') empresaId: string,
    @Body() dto: GoogleCalendarEventDto,
  ) {
    const result = await this.calendarSvc.createEvent(empresaId, {
      summary:       dto.summary,
      description:   dto.description,
      startDateTime: dto.startDateTime,
      endDateTime:   dto.endDateTime,
      location:      dto.location,
      colorId:       dto.colorId,
      referenceId:   dto.referenceId,
      clienteId:     dto.clienteId,
    });
    return StdResponse.ok(result, 'Evento creado');
  }

  @Get(':empresaId/calendar/events')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Listar próximos eventos del calendario' })
  @ApiQuery({ name: 'maxResults', required: false, type: Number })
  async listCalendarEvents(
    @Param('empresaId') empresaId: string,
    @Query('maxResults') maxResults = 20,
  ) {
    const events = await this.calendarSvc.listUpcomingEvents(empresaId, +maxResults);
    return StdResponse.ok(events);
  }

  // ── Contacts ──────────────────────────────────────────────

  @Post(':empresaId/contacts/sync')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Sincronizar un contacto (cliente) con Google Contacts' })
  async syncContact(
    @Param('empresaId') empresaId: string,
    @Body() dto: SyncContactDto,
  ) {
    await this.googleQueue.add(JOBS.GOOGLE_SYNC_CONTACT, {
      empresaId,
      clienteId: dto.clienteId,
      triggered: 'manual',
    }, { attempts: 3 });
    return StdResponse.ok(null, 'Sincronización encolada');
  }

  @Post(':empresaId/contacts/sync-bulk')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Sincronización masiva de contactos' })
  async syncContactsBulk(@Param('empresaId') empresaId: string) {
    await this.googleQueue.add(JOBS.GOOGLE_SYNC_CONTACTS_BULK, {
      empresaId,
      limit: 500,
    }, { attempts: 1 });
    return StdResponse.ok(null, 'Sincronización masiva encolada');
  }

  // ── Drive ─────────────────────────────────────────────────

  @Get(':empresaId/drive/files')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Listar archivos en Google Drive' })
  async listDriveFiles(@Param('empresaId') empresaId: string) {
    const account = await this.oauthSvc.getAccount(empresaId);
    const files   = await this.driveSvc.listFiles(empresaId, account.driveRootFolderId);
    return StdResponse.ok(files);
  }

  @Get(':empresaId/drive/quota')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Cuota de almacenamiento en Google Drive' })
  async getDriveQuota(@Param('empresaId') empresaId: string) {
    const quota = await this.driveSvc.getStorageQuota(empresaId);
    return StdResponse.ok(quota);
  }

  // ── Maps ──────────────────────────────────────────────────

  @Post(':empresaId/maps/geocode')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Geocodificar una dirección con Google Maps' })
  async geocode(
    @Param('empresaId') empresaId: string,
    @Body() dto: GeocodeDto,
  ) {
    const result = await this.mapsSvc.geocode(empresaId, dto.address);
    return StdResponse.ok(result);
  }

  @Post(':empresaId/maps/geocode-queue')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Encolar geocodificación asíncrona para un cliente/contrato' })
  async geocodeQueue(
    @Param('empresaId') empresaId: string,
    @Body() body: { address: string; clienteId?: string; contratoId?: string },
  ) {
    await this.googleQueue.add(JOBS.GOOGLE_GEOCODE_ADDRESS, {
      empresaId,
      address:    body.address,
      clienteId:  body.clienteId,
      contratoId: body.contratoId,
    }, { attempts: 2 });
    return StdResponse.ok(null, 'Geocodificación encolada');
  }
}
