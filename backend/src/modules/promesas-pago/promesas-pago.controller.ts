import {
  Controller, Get, Post, Patch,
  Body, Param, Query, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags }    from '@nestjs/swagger';

import { PromesasPagoService, CrearPromesaDto } from './promesas-pago.service';
import { EstadoPromesa }                         from './entities/promesa-pago.entity';
import { CurrentUser, JwtPayload }               from '../../common/decorators/current-user.decorator';
import { RequirePermission }                     from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse }            from '../../common/dto/response.dto';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

class CrearPromesaBodyDto implements CrearPromesaDto {
  contratoId:       string;
  @IsDateString()
  fechaVencimiento: string;
  @IsOptional() @IsString() @MaxLength(500)
  motivo?: string;
}

class CancelarPromesaDto {
  @IsOptional() @IsString() @MaxLength(500)
  motivo?: string;
}

@ApiTags('Promesas de Pago')
@Controller('promesas-pago')
export class PromesasPagoController {
  constructor(private readonly svc: PromesasPagoService) {}

  @Post() @RequirePermission('contratos:prorroga')
  @ApiOperation({ summary: 'Crear promesa de pago' })
  async crear(
    @Body() dto: CrearPromesaBodyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.crear(dto, user), 'Promesa registrada');
  }

  @Get() @RequirePermission('contratos:view')
  @ApiOperation({ summary: 'Listar promesas de pago' })
  async listar(
    @CurrentUser() user: JwtPayload,
    @Query('estado') estado?: EstadoPromesa,
    @Query('page')   page?:   number,
    @Query('limit')  limit?:  number,
  ) {
    return this.svc.listar(user.empresaId, { estado, page, limit });
  }

  @Get('stats') @RequirePermission('contratos:view')
  @ApiOperation({ summary: 'Estadísticas de promesas' })
  async stats(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.stats(user.empresaId), 'Stats promesas');
  }

  @Patch(':id/cancelar') @RequirePermission('contratos:prorroga')
  @ApiOperation({ summary: 'Cancelar promesa activa' })
  async cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarPromesaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(
      await this.svc.cancelar(id, dto.motivo ?? '', user),
      'Promesa cancelada',
    );
  }
}
