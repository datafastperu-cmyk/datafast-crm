import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlanesService } from './planes.service';
import { CreatePlanDto, UpdatePlanDto, FilterPlanDto } from './dto/plan.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';

@ApiTags('Planes') @ApiBearerAuth('JWT') @Controller('planes')
export class PlanesController {
  constructor(private readonly svc: PlanesService) {}

  @Post() @RequirePermission('planes:manage')
  @ApiOperation({ summary: 'Crear plan de servicio' })
  async create(@Body() dto: CreatePlanDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.create(dto, user), 'Plan creado');
  }

  @Get() @RequirePermission('planes:view')
  @ApiOperation({ summary: 'Listar planes' })
  async findAll(@Query() filters: FilterPlanDto, @CurrentUser() user: JwtPayload) {
    const r = await this.svc.findAll(user.empresaId, filters);
    return ApiResponse.ok(r.data, 'Planes obtenidos', { total: r.total });
  }

  @Get(':id') @RequirePermission('planes:view')
  @ApiOperation({ summary: 'Obtener plan por ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.findOne(id, user.empresaId));
  }

  @Put(':id') @RequirePermission('planes:manage')
  @ApiOperation({ summary: 'Actualizar plan' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.update(id, dto, user), 'Plan actualizado');
  }

  @Delete(':id') @RequirePermission('planes:manage') @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar plan' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    await this.svc.remove(id, user);
  }
}
