import {
  Controller, Get, Post, Patch, Delete, Body, Query, Param,
  HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles }       from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SistemaService, CronHorarios, ProveedorActivo } from './sistema.service';

@ApiTags('Sistema — Admin')
@ApiBearerAuth('JWT')
@Roles('Administrador')
@Controller('admin/sistema')
export class SistemaController {
  private readonly logger = new Logger(SistemaController.name);

  constructor(private readonly sistema: SistemaService) {}

  // ── GET /admin/sistema/info ───────────────────────────────────
  @Get('info')
  @ApiOperation({ summary: 'Versión, estado de procesos y recursos del servidor' })
  async getInfo() {
    const info = await this.sistema.getServerInfo();
    return ApiResponse.ok(info);
  }

  // ── GET /admin/sistema/update-log ────────────────────────────
  @Get('update-log')
  @ApiOperation({ summary: 'Log de la última actualización ejecutada' })
  async getUpdateLog() {
    const log = await this.sistema.getUpdateLog();
    return ApiResponse.ok({ log });
  }

  // ── POST /admin/sistema/restart ──────────────────────────────
  @Post('restart')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Reiniciar todos los procesos PM2' })
  restart() {
    this.sistema.triggerRestart();
    return ApiResponse.ok(
      null,
      'Reinicio iniciado — el servidor se reiniciará en unos segundos',
    );
  }

  // ── POST /admin/sistema/update ───────────────────────────────
  @Post('update')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Descargar e instalar la última actualización' })
  update() {
    this.sistema.triggerUpdate();
    return ApiResponse.ok(
      null,
      'Actualización iniciada en background — el servidor se reiniciará al terminar',
    );
  }

  // ── GET /admin/sistema/crontab ───────────────────────────────
  @Get('crontab')
  @ApiOperation({ summary: 'Obtener horarios de tareas programadas' })
  async getCrontab(@CurrentUser() user: JwtPayload) {
    const horarios = await this.sistema.getCronHorarios(user.empresaId);
    return ApiResponse.ok(horarios);
  }

  // ── PATCH /admin/sistema/crontab ─────────────────────────────
  @Patch('crontab')
  @ApiOperation({ summary: 'Actualizar horarios de tareas programadas' })
  async updateCrontab(
    @Body() body: Partial<CronHorarios>,
    @CurrentUser() user: JwtPayload,
  ) {
    const horarios = await this.sistema.updateCronHorarios(user.empresaId, body);
    return ApiResponse.ok(horarios, 'Horarios actualizados');
  }

  // ── GET /admin/sistema/whatsapp-config ───────────────────────
  @Get('whatsapp-config')
  @ApiOperation({ summary: 'Obtener configuración de WhatsApp Business' })
  async getWhatsAppConfig(@CurrentUser() user: JwtPayload) {
    const cfg = await this.sistema.getWhatsAppConfig(user.empresaId);
    return ApiResponse.ok({
      phoneId:    cfg.phoneId,
      businessId: cfg.businessId,
      token:      cfg.tokenExists ? '***stored***' : null,
    });
  }

  // ── GET /admin/sistema/notif-logs ────────────────────────────
  @Get('notif-logs')
  @ApiOperation({ summary: 'Historial de notificaciones enviadas' })
  async getNotifLogs(
    @CurrentUser() user: JwtPayload,
    @Query('page')   page?:   string,
    @Query('limit')  limit?:  string,
    @Query('estado') estado?: string,
    @Query('tipo')   tipo?:   string,
  ) {
    const result = await this.sistema.getNotifLogs(
      user.empresaId,
      page  ? parseInt(page,  10) : 1,
      limit ? parseInt(limit, 10) : 20,
      estado || undefined,
      tipo   || undefined,
    );
    return ApiResponse.ok(result);
  }

  // ── GET /admin/sistema/notif-logs/:id/preview ───────────────
  @Get('notif-logs/:id/preview')
  @ApiOperation({ summary: 'Vista previa del contenido del mensaje enviado' })
  async previewNotifLog(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.sistema.previewNotifLog(id, user.empresaId);
    return ApiResponse.ok(result);
  }

  // ── POST /admin/sistema/notif-logs/:id/reenviar ──────────────
  @Post('notif-logs/:id/reenviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenviar una notificación fallida o encolada' })
  async reenviarNotifLog(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.sistema.reenviarNotifLog(id, user.empresaId);
    return ApiResponse.ok(result, result.enviado ? 'Notificación reenviada' : 'Falló el reenvío');
  }

  // ── DELETE /admin/sistema/notif-logs/:id ─────────────────────
  @Delete('notif-logs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un registro de notificación' })
  async eliminarNotifLog(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.sistema.eliminarNotifLog(id, user.empresaId);
  }

  // ── PATCH /admin/sistema/whatsapp-config ─────────────────────
  @Patch('whatsapp-config')
  @ApiOperation({ summary: 'Actualizar token y Phone ID de WhatsApp Business' })
  async updateWhatsAppConfig(
    @Body() body: { token?: string; phoneId?: string; businessId?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const cfg = await this.sistema.updateWhatsAppConfig(user.empresaId, body);
    return ApiResponse.ok(
      {
        phoneId:    cfg.phoneId,
        businessId: cfg.businessId,
        token:      cfg.tokenExists ? '***stored***' : null,
      },
      'Configuración de WhatsApp actualizada',
    );
  }

  // ── GET /admin/sistema/gateway-config ────────────────────────
  @Get('gateway-config')
  @ApiOperation({ summary: 'Obtener proveedor de mensajería activo y credenciales' })
  async getGatewayConfig(@CurrentUser() user: JwtPayload) {
    const cfg = await this.sistema.getGatewayConfig(user.empresaId);
    return ApiResponse.ok({
      proveedorActivo:        cfg.proveedorActivo,
      apiKeyStored:           cfg.apiKeyStored,
      apiSecretStored:        cfg.apiSecretStored,
      clientId:               cfg.clientId,
      pausa:                  cfg.pausa,
      limiteCaracteres:       cfg.limiteCaracteres,
      codigoPais:             cfg.codigoPais,
      activo:                 cfg.activo,
      metaGraphActivo:        cfg.metaGraphActivo,
      twilioActivo:           cfg.twilioActivo,
      vonageActivo:           cfg.vonageActivo,
      customApiActivo:        cfg.customApiActivo,
      automatizadoVipActivo:  cfg.automatizadoVipActivo,
      limiteDiarioMasivo:     cfg.limiteDiarioMasivo,
      whatsappNumeroOrigen:   cfg.whatsappNumeroOrigen,
      notifBienvenidaActiva:   cfg.notifBienvenidaActiva,
      notifPagoRecibidoActiva: cfg.notifPagoRecibidoActiva,
      notifProrrogaActiva:     cfg.notifProrrogaActiva,
      notifSuspensionActiva:   cfg.notifSuspensionActiva,
    });
  }

  // ── PATCH /admin/sistema/gateway-config ──────────────────────
  @Patch('gateway-config')
  @ApiOperation({ summary: 'Actualizar proveedor de mensajería y credenciales' })
  async updateGatewayConfig(
    @Body() body: {
      proveedorActivo?:         ProveedorActivo;
      apiKey?:                  string;
      apiSecret?:               string;
      clientId?:                string;
      pausa?:                   number;
      limiteCaracteres?:        number;
      codigoPais?:              string;
      activo?:                  boolean;
      limiteDiarioMasivo?:      number;
      whatsappNumeroOrigen?:    string;
      notifBienvenidaActiva?:   boolean;
      notifPagoRecibidoActiva?: boolean;
      notifProrrogaActiva?:     boolean;
      notifSuspensionActiva?:   boolean;
    },
    @CurrentUser() user: JwtPayload,
  ) {
    const cfg = await this.sistema.updateGatewayConfig(user.empresaId, body);
    return ApiResponse.ok(
      {
        proveedorActivo:        cfg.proveedorActivo,
        apiKeyStored:           cfg.apiKeyStored,
        apiSecretStored:        cfg.apiSecretStored,
        clientId:               cfg.clientId,
        pausa:                  cfg.pausa,
        limiteCaracteres:       cfg.limiteCaracteres,
        codigoPais:             cfg.codigoPais,
        activo:                 cfg.activo,
        metaGraphActivo:        cfg.metaGraphActivo,
        twilioActivo:           cfg.twilioActivo,
        vonageActivo:           cfg.vonageActivo,
        customApiActivo:        cfg.customApiActivo,
        automatizadoVipActivo:  cfg.automatizadoVipActivo,
        limiteDiarioMasivo:     cfg.limiteDiarioMasivo,
        whatsappNumeroOrigen:   cfg.whatsappNumeroOrigen,
        notifBienvenidaActiva:   cfg.notifBienvenidaActiva,
        notifPagoRecibidoActiva: cfg.notifPagoRecibidoActiva,
        notifProrrogaActiva:     cfg.notifProrrogaActiva,
        notifSuspensionActiva:   cfg.notifSuspensionActiva,
      },
      'Configuración de gateway actualizada',
    );
  }
}
