import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, ParseUUIDPipe, HttpCode, HttpStatus, SetMetadata } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty, MaxLength, IsIP, IsInt, IsBoolean, IsArray, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { ContratosService } from './contratos.service';
import { IpPoolService } from './ip-pool.service';
import { CreateContratoDto, UpdateContratoDto, FilterContratoDto, CambiarEstadoContratoDto, OtorgarProrrogaDto } from './dto/contrato.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

class CreateSegmentoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) nombre: string;
  @ApiPropertyOptional() @IsOptional() @IsString() descripcion?: string;
  @ApiProperty({ example: '192.168.1.0/24' }) @IsString() @IsNotEmpty() redCidr: string;
  @ApiProperty({ example: '192.168.1.1' }) @IsIP() gateway: string;
  @ApiPropertyOptional({ default: '8.8.8.8' }) @IsOptional() @IsIP() dnsPrimario?: string;
  @ApiPropertyOptional() @IsOptional() @IsIP() dnsSecundario?: string;
  @ApiPropertyOptional() @IsOptional() routerId?: string;
  @ApiPropertyOptional() @IsOptional() nodoId?: string;
  @ApiPropertyOptional({ enum: ['ftth','wisp','dedicado'], default: 'ftth' }) @IsOptional() @IsString() tipoServicio?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) vlanId?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() ipsReservadas?: string[];
}

@ApiTags('Contratos') @ApiBearerAuth('JWT') @Controller('contratos')
export class ContratosController {
  constructor(
    private readonly svc: ContratosService,
    private readonly ipPool: IpPoolService,
  ) {}

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

  // ── Segmentos IPv4 — rutas literales ANTES de `:id` ────────
  // IMPORTANTE: en NestJS/Express las rutas se registran en orden de
  // declaración. Cualquier ruta literal de 1 segmento (ej: 'segmentos')
  // debe declararse ANTES de la ruta paramétrica ':id', de lo contrario
  // ':id' la captura primero y lanza ParseUUIDPipe error.

  @Get('segmentos') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar segmentos IPv4 de la empresa' })
  @ApiQuery({ name: 'routerId', required: false })
  async listSegmentos(@Query('routerId') routerId: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.ipPool.getSegmentos(user.empresaId, routerId));
  }

  @Post('segmentos') @RequirePermission('contratos:create')
  @ApiOperation({ summary: 'Crear segmento IPv4' })
  async createSegmento(@Body() dto: CreateSegmentoDto, @CurrentUser() user: JwtPayload) {
    const seg = await this.ipPool.createSegmento({ ...dto, empresaId: user.empresaId });
    return StdResponse.ok(seg, 'Segmento creado correctamente');
  }

  @Get('segmentos/:segId') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener segmento por ID' })
  @ApiParam({ name: 'segId' })
  async getSegmento(@Param('segId', ParseUUIDPipe) segId: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.ipPool.getSegmento(segId, user.empresaId));
  }

  @Get('segmentos/:segId/next-ip') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Primera IP disponible en el segmento (sugerencia, no asigna)' })
  @ApiParam({ name: 'segId' })
  async getNextIp(@Param('segId', ParseUUIDPipe) segId: string, @CurrentUser() user: JwtPayload) {
    const ip = await this.ipPool.getSiguienteIpSugerida(segId, user.empresaId);
    return StdResponse.ok({ ip }, ip ? 'IP disponible' : 'Sin IPs disponibles');
  }

  @Get('segmentos/:segId/disponibilidad') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Ver disponibilidad de IPs en un segmento' })
  @ApiParam({ name: 'segId' })
  async getDisponibilidad(@Param('segId', ParseUUIDPipe) segId: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.ipPool.getDisponibilidad(segId, user.empresaId));
  }

  @Put('segmentos/:segId') @RequirePermission('contratos:edit')
  @ApiOperation({ summary: 'Actualizar segmento IPv4 (bloqueado si hay IPs asignadas)' })
  @ApiParam({ name: 'segId' })
  async updateSegmento(
    @Param('segId', ParseUUIDPipe) segId: string,
    @Body() dto: CreateSegmentoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const seg = await this.ipPool.updateSegmento(segId, user.empresaId, dto);
    return StdResponse.ok(seg, 'Segmento actualizado correctamente');
  }

  @Delete('segmentos/:segId') @RequirePermission('contratos:delete') @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desactivar segmento IPv4 (bloqueado si hay IPs asignadas)' })
  @ApiParam({ name: 'segId' })
  async removeSegmento(@Param('segId', ParseUUIDPipe) segId: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.ipPool.desactivarSegmento(segId, user.empresaId);
  }

  // ── Contratos por ID — rutas paramétricas ──────────────────

  @Get('cliente/:clienteId') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar todos los contratos de un cliente' })
  @ApiParam({ name:'clienteId', description:'UUID del cliente' })
  async findByCliente(@Param('clienteId', ParseUUIDPipe) clienteId: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.findByCliente(clienteId, user.empresaId));
  }

  @Get(':id') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener contrato con datos completos (JOINs: cliente, plan, router, ONU)' })
  @ApiParam({ name:'id', description:'UUID del contrato' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.findOneCompleto(id, user.empresaId));
  }

  @Get(':id/historial') @RequirePermission('contratos:view') @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Historial de cambios de estado del contrato' })
  @ApiParam({ name:'id' })
  async getHistorial(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getHistorial(id, user.empresaId));
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

  @Delete(':id') @RequirePermission('contratos:delete') @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar contrato (solo si está en BAJA_DEFINITIVA)' })
  @ApiParam({ name:'id' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.svc.remove(id, user);
  }
}
