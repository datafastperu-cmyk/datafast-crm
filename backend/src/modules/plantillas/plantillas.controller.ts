import { Controller, Get, Put, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { PlantillasService } from './plantillas.service';
import { TipoPlantilla } from './entities/plantilla-mensaje.entity';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';

class GuardarPlantillaDto {
  @IsString() @IsNotEmpty() contenido: string;
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
    const data = await this.svc.guardar(user.empresaId, tipo, codigo, dto.contenido);
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
}
