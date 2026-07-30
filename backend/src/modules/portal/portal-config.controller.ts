import {
  Controller, Get, Put, Post, Delete,
  Body, Param, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse }             from '../../common/dto/response.dto';

import { PortalConfigService } from './portal-config.service';
import { UpdatePortalConfigDto, UpsertPortalBannerDto } from './dto/portal-config.dto';

// Administración del Portal del Cliente desde el ERP (/configuracion/portal-cliente).
// Este controller lo consume el OPERADOR con su JWT interno. El portal del abonado
// tendrá su propia superficie bajo /portal/* con guard y audiencia distintas.
@ApiTags('Configuración')
@ApiBearerAuth('JWT')
@Controller('config/portal')
export class PortalConfigController {
  constructor(private readonly svc: PortalConfigService) {}

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
