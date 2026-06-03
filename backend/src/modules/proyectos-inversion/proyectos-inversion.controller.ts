import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SetMetadata } from '@nestjs/common';
import { ProyectosInversionService } from './proyectos-inversion.service';
import {
  CreateProyectoInversionDto,
  UpdateProyectoInversionDto,
  FilterProyectoInversionDto,
} from './proyecto-inversion.dto';
import { ApiResponse } from '../../common/dto/response.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';

@ApiTags('Finanzas — Proyectos de Inversión')
@ApiBearerAuth('JWT')
@Controller('proyectos-inversion')
export class ProyectosInversionController {
  constructor(private readonly svc: ProyectosInversionService) {}

  @Get()
  @RequirePermission('pagos:view')
  @ApiOperation({ summary: 'Listar proyectos de inversión' })
  async list(@Query() filtros: FilterProyectoInversionDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.list(user.empresaId, filtros));
  }

  @Get(':id/ratios')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Calcular VAN, TIR y Payback del proyecto' })
  async ratios(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return ApiResponse.ok(await this.svc.calcularRatiosFinancieros(id, user.empresaId));
  }

  @Get(':id')
  @RequirePermission('pagos:view')
  @ApiOperation({ summary: 'Obtener proyecto por ID' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return ApiResponse.ok(await this.svc.getById(id, user.empresaId));
  }

  @Post()
  @RequirePermission('pagos:manage')
  @ApiOperation({ summary: 'Crear proyecto de inversión' })
  async create(@Body() dto: CreateProyectoInversionDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.create(user.empresaId, dto), 'Proyecto creado');
  }

  @Put(':id')
  @RequirePermission('pagos:manage')
  @ApiOperation({ summary: 'Actualizar proyecto' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProyectoInversionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return ApiResponse.ok(await this.svc.update(id, user.empresaId, dto), 'Proyecto actualizado');
  }

  @Delete(':id')
  @RequirePermission('pagos:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar proyecto' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.svc.remove(id, user.empresaId);
  }
}
