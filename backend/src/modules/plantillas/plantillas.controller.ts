import { Controller, Get, Put, Post, Delete, Body, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { PlantillasService } from './plantillas.service';
import { TipoPlantilla } from './entities/plantilla-mensaje.entity';
import { FacturacionConfig, NotificacionesConfig } from './entities/plantilla-abonado.entity';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';

class GuardarPlantillaDto {
  @IsString() @IsNotEmpty() contenido: string;
  @IsString() @IsOptional() nombre?: string;
}

class CrearPlantillaDto {
  @IsString() @IsNotEmpty() nombre: string;
  @IsString() @IsNotEmpty() contenido: string;
}

class SavePlantillaAbonadoDto {
  @IsString() @IsNotEmpty() nombre: string;
  @IsObject() facturacion: FacturacionConfig;
  @IsObject() notificaciones: NotificacionesConfig;
}

@ApiTags('Plantillas de Mensajes')
@ApiBearerAuth('JWT')
@Controller('plantillas')
export class PlantillasController {
  constructor(private readonly svc: PlantillasService) {}

  @Get()
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Listar plantillas por tipo' })
  @ApiQuery({ name: 'tipo', enum: ['whatsapp', 'email', 'documento'] })
  async listar(@Query('tipo') tipo: TipoPlantilla, @CurrentUser() user: JwtPayload) {
    const data = await this.svc.listar(user.empresaId, tipo ?? 'whatsapp');
    return ApiResponse.ok(data);
  }

  @Put(':tipo/:codigo')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Guardar / actualizar una plantilla' })
  async guardar(
    @Param('tipo') tipo: TipoPlantilla,
    @Param('codigo') codigo: string,
    @Body() dto: GuardarPlantillaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.svc.guardar(user.empresaId, tipo, codigo, dto.contenido, dto.nombre);
    return ApiResponse.ok(data, 'Plantilla guardada');
  }

  @Post(':tipo/:codigo/restaurar')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Restaurar plantilla al contenido por defecto' })
  async restaurar(
    @Param('tipo') tipo: TipoPlantilla,
    @Param('codigo') codigo: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.svc.restaurar(user.empresaId, tipo, codigo);
    return ApiResponse.ok(data, 'Plantilla restaurada al valor por defecto');
  }

  @Post(':tipo')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Crear plantilla personalizada' })
  async crear(
    @Param('tipo') tipo: TipoPlantilla,
    @Body() dto: CrearPlantillaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.svc.crear(user.empresaId, tipo, dto.nombre, dto.contenido);
    return ApiResponse.ok(data, 'Plantilla creada');
  }

  @Delete(':tipo/:codigo')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Eliminar plantilla personalizada (no del sistema)' })
  async eliminar(
    @Param('tipo') tipo: TipoPlantilla,
    @Param('codigo') codigo: string,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      await this.svc.eliminar(user.empresaId, tipo, codigo);
      return ApiResponse.ok(null, 'Plantilla eliminada');
    } catch (e: any) {
      if (e.message === 'No se pueden eliminar plantillas del sistema') throw new BadRequestException(e.message);
      if (e.message === 'Plantilla no encontrada') throw new NotFoundException(e.message);
      throw e;
    }
  }

  // ─── Plantillas Abonados ─────────────────────────────────────
  @Get('abonados')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Listar plantillas de configuración de abonados' })
  async listarAbonados(@CurrentUser() user: JwtPayload) {
    const data = await this.svc.listarAbonados(user.empresaId);
    return ApiResponse.ok(data);
  }

  @Post('abonados')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Crear nueva plantilla de abonado' })
  async crearAbonado(@Body() dto: SavePlantillaAbonadoDto, @CurrentUser() user: JwtPayload) {
    const data = await this.svc.crearAbonado(user.empresaId, dto.nombre, dto.facturacion, dto.notificaciones);
    return ApiResponse.ok(data, 'Plantilla creada');
  }

  @Put('abonados/:id')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Actualizar plantilla de abonado' })
  async actualizarAbonado(
    @Param('id') id: string,
    @Body() dto: SavePlantillaAbonadoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.svc.actualizarAbonado(id, user.empresaId, dto.nombre, dto.facturacion, dto.notificaciones);
    return ApiResponse.ok(data, 'Plantilla actualizada');
  }

  @Delete('abonados/:id')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Eliminar plantilla de abonado' })
  async eliminarAbonado(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.svc.eliminarAbonado(id, user.empresaId);
    return ApiResponse.ok(null, 'Plantilla eliminada');
  }
}
