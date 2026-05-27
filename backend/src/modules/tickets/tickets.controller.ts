import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, ParseUUIDPipe,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { TicketsService }       from './tickets.service';
import {
  CreateTicketDto, UpdateTicketDto, CerrarTicketDto,
  CalificarTicketDto, CreateComentarioDto, FilterTicketDto,
} from './dto/ticket.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Tickets')
@ApiBearerAuth('JWT')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Get('stats')
  @RequirePermission('tickets:view')
  @ApiOperation({ summary: 'Estadísticas de tickets' })
  async stats(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getStats(user.empresaId));
  }

  @Get()
  @RequirePermission('tickets:view')
  @ApiOperation({ summary: 'Listar tickets con filtros y paginación' })
  async findAll(@Query() filters: FilterTicketDto, @CurrentUser() user: JwtPayload) {
    const r = await this.svc.findAll(user.empresaId, filters);
    return StdResponse.ok(r.data, 'Tickets obtenidos', { meta: r.meta });
  }

  @Post()
  @RequirePermission('tickets:create')
  @ApiOperation({ summary: 'Crear ticket de soporte' })
  async create(@Body() dto: CreateTicketDto, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.create(dto, user), 'Ticket creado');
  }

  @Get(':id')
  @RequirePermission('tickets:view')
  @ApiOperation({ summary: 'Obtener detalle de ticket' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findOne(id, user.empresaId));
  }

  @Patch(':id')
  @RequirePermission('tickets:edit')
  @ApiOperation({ summary: 'Actualizar ticket' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.update(id, dto, user), 'Ticket actualizado');
  }

  @Patch(':id/cerrar')
  @RequirePermission('tickets:edit')
  @ApiOperation({ summary: 'Cerrar ticket con solución' })
  async cerrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CerrarTicketDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.cerrar(id, dto, user), 'Ticket resuelto');
  }

  @Patch(':id/asignar/:tecnicoId')
  @RequirePermission('tickets:edit')
  @ApiOperation({ summary: 'Asignar técnico al ticket' })
  async asignar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tecnicoId', ParseUUIDPipe) tecnicoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.asignarTecnico(id, tecnicoId, user), 'Técnico asignado');
  }

  @Patch(':id/calificar')
  @RequirePermission('tickets:edit')
  @ApiOperation({ summary: 'Calificar atención del ticket' })
  async calificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CalificarTicketDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.calificar(id, dto, user), 'Ticket calificado');
  }

  @Delete(':id')
  @RequirePermission('tickets:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar ticket (soft delete)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.softDelete(id, user);
  }

  // ── Comentarios ────────────────────────────────────────────
  @Get(':id/comentarios')
  @RequirePermission('tickets:view')
  async getComentarios(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getComentarios(id, user.empresaId));
  }

  @Post(':id/comentarios')
  @RequirePermission('tickets:edit')
  async addComentario(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateComentarioDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.addComentario(id, dto, user), 'Comentario agregado');
  }
}
