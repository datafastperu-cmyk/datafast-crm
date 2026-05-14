import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, ParseUUIDPipe, HttpCode, HttpStatus, SetMetadata } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { ContratosService } from './contratos.service';
import { CreateContratoDto, UpdateContratoDto, FilterContratoDto, CambiarEstadoContratoDto, OtorgarProrrogaDto } from './dto/contrato.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Contratos') @ApiBearerAuth('JWT') @Controller('contratos')
export class ContratosController {
  constructor(private readonly svc: ContratosService) {}

  @Post() @RequirePermission('contratos:create')
  @ApiOperation({ summary: 'Crear contrato — asigna IP automáticamente del pool si se provee segmentoId' })
  @ApiResponse({ status: 201, description: 'Contrato creado' })
  @ApiResponse({ status: 409, description: 'Conflicto: IP ocupada o contrato duplicado' })
  @ApiResponse({ status: 422, description: 'Pool IPv4 exhausto' })
  async create(@Body() dto: CreateContratoDto, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return StdResponse.ok(await this.svc.create(dto, user, req), 'Contrato creado correctamente');
  }

  @Get() @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar contratos con filtros y paginación' })
  async findAll(@Query() filters: FilterContratoDto, @CurrentUser() user: JwtPayload) {
    const r = await this.svc.findAll(user.empresaId, filters);
    return StdResponse.ok(r.data, 'Contratos obtenidos', { meta: r.meta });
  }

  @Get('resumen') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Resumen de contratos por estado (dashboard)' })
  async getResumen(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getResumen(user.empresaId));
  }

  @Get(':id') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener contrato con datos completos (JOINs: cliente, plan, router, ONU)' })
  @ApiParam({ name:'id', description:'UUID del contrato' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.findOneCompleto(id, user.empresaId));
  }

  @Get('cliente/:clienteId') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar todos los contratos de un cliente' })
  @ApiParam({ name:'clienteId', description:'UUID del cliente' })
  async findByCliente(@Param('clienteId', ParseUUIDPipe) clienteId: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.findByCliente(clienteId, user.empresaId));
  }

  @Put(':id') @RequirePermission('contratos:edit')
  @ApiOperation({ summary: 'Actualizar datos del contrato (no cambia IP ni PPPoE)' })
  @ApiParam({ name:'id' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContratoDto, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return StdResponse.ok(await this.svc.update(id, dto, user, req), 'Contrato actualizado');
  }

  @Patch(':id/activar') @RequirePermission('contratos:edit')
  @ApiOperation({ summary: 'Activar contrato (PENDIENTE_INSTALACION → ACTIVO) al finalizar la instalación' })
  @ApiParam({ name:'id' })
  async activar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return StdResponse.ok(await this.svc.activar(id, user, req), 'Contrato activado — servicio habilitado');
  }

  @Patch(':id/estado') @RequirePermission('contratos:edit')
  @ApiOperation({ summary: 'Cambiar estado del contrato — respeta máquina de estados' })
  @ApiParam({ name:'id' })
  @ApiResponse({ status:400, description:'Transición no permitida' })
  async cambiarEstado(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CambiarEstadoContratoDto, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return StdResponse.ok(await this.svc.cambiarEstado(id, dto, user, false, req), `Estado → ${dto.estado}`);
  }

  @Patch(':id/prorroga') @RequirePermission('contratos:prorroga')
  @ApiOperation({ summary: 'Otorgar prórroga al contrato' })
  @ApiParam({ name:'id' })
  async otorgarProrroga(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OtorgarProrrogaDto, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return StdResponse.ok(await this.svc.otorgarProrroga(id, dto, user, req), `Prórroga otorgada hasta ${dto.prorrogaHasta}`);
  }

  @Get(':id/historial') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Historial de cambios de estado del contrato' })
  @ApiParam({ name:'id' })
  async getHistorial(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getHistorial(id, user.empresaId));
  }

  @Delete(':id') @RequirePermission('contratos:delete') @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar contrato (solo si está en BAJA_DEFINITIVA)' })
  @ApiParam({ name:'id' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.svc.remove(id, user);
  }
}
