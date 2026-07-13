import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SitesService } from './sites.service';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';

@ApiTags('Sites')
@Controller('sites')
export class SitesController {
  constructor(private readonly service: SitesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar Sites activos de la empresa' })
  async listar(@CurrentUser() user: JwtPayload) {
    return this.service.listar(user.empresaId);
  }

  @Get(':siteId')
  @ApiOperation({ summary: 'Detalle de un Site: Router + VPN + OLTs asociadas' })
  async detalle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.detalle(user.empresaId, siteId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear Site' })
  async crear(@Body() dto: CreateSiteDto, @CurrentUser() user: JwtPayload) {
    return this.service.crear(user.empresaId, dto);
  }

  @Patch(':siteId')
  @ApiOperation({ summary: 'Actualizar Site' })
  async actualizar(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Body() dto: UpdateSiteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.actualizar(user.empresaId, siteId, dto);
  }

  @Delete(':siteId')
  @ApiOperation({ summary: 'Eliminar Site (soft delete)' })
  async eliminar(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.eliminar(user.empresaId, siteId);
    return { ok: true };
  }
}
