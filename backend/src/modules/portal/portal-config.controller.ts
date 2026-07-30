import {
  Controller, Get, Put, Post, Delete,
  Body, Param, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse }             from '../../common/dto/response.dto';

import { PortalConfigService } from './portal-config.service';
import { UpdatePortalConfigDto, UpsertPortalBannerDto, ResolverSolicitudPlanDto } from './dto/portal-config.dto';
import { PortalPlanesService } from './portal-planes.service';

// Administración del Portal del Cliente desde el ERP (/configuracion/portal-cliente).
// Este controller lo consume el OPERADOR con su JWT interno. El portal del abonado
// tendrá su propia superficie bajo /portal/* con guard y audiencia distintas.
@ApiTags('Configuración')
@ApiBearerAuth('JWT')
@Controller('config/portal')
export class PortalConfigController {
  constructor(
    private readonly svc: PortalConfigService,
    private readonly planes: PortalPlanesService,
  ) {}

  @Get()
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Configuración del portal del cliente' })
  async obtener(@CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.obtener(user.empresaId));
  }

  @Put()
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Guardar la configuración del portal del cliente' })
  async actualizar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePortalConfigDto,
  ) {
    const resultado = await this.svc.actualizar(user.empresaId, dto);
    return ApiResponse.ok(resultado, 'Configuración guardada');
  }

  // ── Bandeja de solicitudes de cambio de plan ────────────────
  // Vive junto a la configuración del portal porque es donde el operador administra todo
  // lo que llega desde ahí. Resolver NO aplica el cambio de plan: registra el veredicto.
  // El cambio se ejecuta por el flujo de negocio existente, nunca por un UPDATE directo
  // —eso se saltaría la cola del MikroTik, el precio del contrato y el prorrateo—.
  @Get('solicitudes-plan')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Solicitudes de cambio de plan enviadas desde el portal' })
  async solicitudesPlan(
    @CurrentUser() user: JwtPayload,
    @Query('estado') estado?: string,
  ) {
    return ApiResponse.ok(await this.planes.bandeja(user.empresaId, estado));
  }

  @Post('solicitudes-plan/:id/resolver')
  @RequirePermission('configuracion:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Aprobar, rechazar o marcar como aplicada una solicitud' })
  @ApiParam({ name: 'id' })
  async resolverSolicitud(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolverSolicitudPlanDto,
  ): Promise<void> {
    await this.planes.resolver(user.empresaId, id, user.sub, dto.decision, dto.motivo);
  }

  // ── Banners ─────────────────────────────────────────────────
  @Get('banners')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Banners del portal' })
  async listarBanners(@CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.listarBanners(user.empresaId));
  }

  @Post('banners')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Crear banner del portal' })
  async crearBanner(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertPortalBannerDto,
  ) {
    return ApiResponse.ok(await this.svc.crearBanner(user.empresaId, dto), 'Banner creado');
  }

  @Put('banners/:id')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Actualizar banner del portal' })
  @ApiParam({ name: 'id' })
  async actualizarBanner(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPortalBannerDto,
  ) {
    return ApiResponse.ok(
      await this.svc.actualizarBanner(user.empresaId, id, dto),
      'Banner actualizado',
    );
  }

  @Delete('banners/:id')
  @RequirePermission('configuracion:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar banner del portal' })
  @ApiParam({ name: 'id' })
  async eliminarBanner(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.svc.eliminarBanner(user.empresaId, id);
  }
}
