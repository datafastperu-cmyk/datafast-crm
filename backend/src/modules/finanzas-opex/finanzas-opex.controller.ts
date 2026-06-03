import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FinanzasOpexService } from './finanzas-opex.service';
import {
  CreateEgresoIngresoDto, UpdateEgresoIngresoDto, FilterEgresoIngresoDto,
} from './egreso-ingreso.dto';
import { ApiResponse } from '../../common/dto/response.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';

@ApiTags('Finanzas — OpEx / Otros Ingresos')
@ApiBearerAuth('JWT')
@Controller('finanzas/opex')
export class FinanzasOpexController {
  constructor(private readonly svc: FinanzasOpexService) {}

  @Get('resumen')
  @RequirePermission('pagos:view')
  @ApiOperation({ summary: 'Resumen del mes: ingresos, egresos y pendientes' })
  async resumen(@CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.getResumen(user.empresaId));
  }

  @Get('pendientes')
  @RequirePermission('pagos:view')
  @ApiOperation({ summary: 'Listar obligaciones pendientes de pago' })
  async pendientes(@CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.getPendientes(user.empresaId));
  }

  @Get(':id')
  @RequirePermission('pagos:view')
  @ApiOperation({ summary: 'Obtener registro por ID' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return ApiResponse.ok(await this.svc.getById(id, user.empresaId));
  }

  @Get()
  @RequirePermission('pagos:view')
  @ApiOperation({ summary: 'Listar egresos / ingresos con filtros paginados' })
  async list(@Query() filtros: FilterEgresoIngresoDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.list(user.empresaId, filtros));
  }

  @Post()
  @RequirePermission('pagos:manage')
  @ApiOperation({ summary: 'Registrar nuevo egreso / ingreso (o plantilla recurrente)' })
  async create(@Body() dto: CreateEgresoIngresoDto, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.create(user.empresaId, dto), 'Registro creado');
  }

  @Put(':id')
  @RequirePermission('pagos:manage')
  @ApiOperation({ summary: 'Actualizar registro' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEgresoIngresoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return ApiResponse.ok(await this.svc.update(id, user.empresaId, dto), 'Registro actualizado');
  }

  @Patch(':id/marcar-pagado')
  @RequirePermission('pagos:manage')
  @ApiOperation({ summary: 'Marcar obligación PENDIENTE_PAGO como PAGADO' })
  async marcarPagado(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return ApiResponse.ok(await this.svc.marcarPagado(id, user.empresaId), 'Marcado como pagado');
  }

  @Delete(':id')
  @RequirePermission('pagos:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar registro' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.svc.remove(id, user.empresaId);
  }
}
