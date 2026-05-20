import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ZonasService } from './zonas.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';

class ZonaDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) nombre: string;
}

@ApiTags('Zonas') @ApiBearerAuth('JWT') @Controller('zonas')
export class ZonasController {
  constructor(private readonly svc: ZonasService) {}

  @Get() @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Listar zonas' })
  async list(@Query('search') search: string, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.list(user.empresaId, search));
  }

  @Post() @RequirePermission('configuracion:edit')
  @ApiOperation({ summary: 'Crear zona' })
  async create(@Body() dto: ZonaDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.create(user.empresaId, dto.nombre), 'Zona creada');
  }

  @Put(':id') @RequirePermission('configuracion:edit')
  @ApiOperation({ summary: 'Actualizar zona' })
  async update(@Param('id') id: string, @Body() dto: ZonaDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.update(id, user.empresaId, dto.nombre), 'Zona actualizada');
  }

  @Delete(':id') @RequirePermission('configuracion:edit') @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar zona' })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.svc.remove(id, user.empresaId);
  }
}
