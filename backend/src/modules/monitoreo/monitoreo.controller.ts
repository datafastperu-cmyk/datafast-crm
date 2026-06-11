// Ruta: /opt/datafast/backend/src/modules/monitoreo/monitoreo.controller.ts

import {
  Body, Controller, DefaultValuePipe, Delete, Get, Param,
  ParseIntPipe, ParseUUIDPipe, Patch, Post, Query,
}                            from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  MonitoreoService, ProbarConexionDto, CreateDispositivoDto, UpdateDispositivoDto,
  FiltroAlertaQuery, ResolverAlertaDto, CreateUmbralDto,
} from './monitoreo.service';
import { RequirePermission }   from '../../common/decorators/roles.decorator';
import { CurrentUser }         from '../../common/decorators/current-user.decorator';
import { JwtPayload }          from '../../common/decorators/current-user.decorator';

@ApiTags('Monitoreo')
@Controller('monitoreo')
export class MonitoreoController {
  constructor(private readonly monitoreoSvc: MonitoreoService) {}

  // ── GET /monitoreo/tiempo-real ───────────────────────────────
  // Resumen global + lista de dispositivos con última métrica
  @Get('tiempo-real')
  @RequirePermission('monitoring:view')
  @ApiOperation({ summary: 'Estado en tiempo real de todos los dispositivos' })
  getTiempoReal(@CurrentUser() user: JwtPayload) {
    return this.monitoreoSvc.getTiempoReal(user.empresaId);
  }

  // ── GET /monitoreo/dispositivos/:id/clientes ─────────────────
  // MACs conectadas en vivo (solo ANTENA_AP MikroTik)
  @Get('dispositivos/:id/clientes')
  @RequirePermission('monitoring:view')
  @ApiOperation({ summary: 'Clientes inalámbricos conectados a la antena (en vivo)' })
  getClientes(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.monitoreoSvc.getClientesConectados(id, user.empresaId);
  }

  // ── POST /monitoreo/dispositivos/probar-conexion ─────────────
  // Valida credenciales antes de guardar un dispositivo
  @Post('dispositivos/probar-conexion')
  @RequirePermission('monitoring:manage')  // S2: conectar a un router requiere manage, no solo view
  @ApiOperation({ summary: 'Prueba rápida de credenciales MikroTik (no guarda datos)' })
  probarConexion(@Body() dto: ProbarConexionDto) {
    return this.monitoreoSvc.probarConexion(dto);
  }
  // ── POST /monitoreo/dispositivos ────────────────────────────
  @Post('dispositivos')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Registrar nuevo dispositivo de monitoreo' })
  createDispositivo(
    @Body() dto: CreateDispositivoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.monitoreoSvc.createDispositivo(dto, user.empresaId);
  }
  // ── GET /monitoreo/dispositivos ──────────────────────────────
  @Get('dispositivos')
  @RequirePermission('monitoring:view')
  @ApiOperation({ summary: 'Listar dispositivos de monitoreo' })
  getDispositivos(@CurrentUser() user: JwtPayload) {
    return this.monitoreoSvc.getDispositivos(user.empresaId);
  }

  // ── GET /monitoreo/dispositivos/:id ─────────────────────────
  @Get('dispositivos/:id')
  @RequirePermission('monitoring:view')
  @ApiOperation({ summary: 'Obtener dispositivo por id' })
  getDispositivo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.monitoreoSvc.findDispositivo(id, user.empresaId);
  }

  // ── PATCH /monitoreo/dispositivos/:id ────────────────────────
  @Patch('dispositivos/:id')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Actualizar dispositivo de monitoreo' })
  updateDispositivo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDispositivoDto,
  ) {
    return this.monitoreoSvc.updateDispositivo(id, user.empresaId, dto);
  }

  // ── POST /monitoreo/dispositivos/:id/reparar ────────────────
  @Post('dispositivos/:id/reparar')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Re-registrar MACs y comentarios de abonados en la Access List de una Antena AP' })
  repararAntenaAP(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.monitoreoSvc.repararAntenaAP(id, user.empresaId);
  }

  // ── DELETE /monitoreo/dispositivos/:id ───────────────────────
  @Delete('dispositivos/:id')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Eliminar dispositivo de monitoreo (soft delete)' })
  deleteDispositivo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.monitoreoSvc.deleteDispositivo(id, user.empresaId);
  }

  // ── GET /monitoreo/alertas ───────────────────────────────────
  @Get('alertas')
  @RequirePermission('monitoring:view')
  @ApiOperation({ summary: 'Listar alertas con filtro' })
  getAlertas(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('nivel')  nivel?:  string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page  = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.monitoreoSvc.getAlertas(user.empresaId, {
      status: status as any,
      nivel:  nivel  as any,
      page,
      limit,
    });
  }

  // ── PATCH /monitoreo/alertas/:id/resolver ────────────────────
  @Patch('alertas/:id/resolver')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Resolver alerta' })
  resolverAlerta(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ResolverAlertaDto,
  ) {
    return this.monitoreoSvc.resolverAlerta(id, user.empresaId, user.sub, dto);
  }

  // ── GET /monitoreo/umbrales ──────────────────────────────────
  @Get('umbrales')
  @RequirePermission('monitoring:view')
  @ApiOperation({ summary: 'Listar umbrales de alerta' })
  getUmbrales(
    @CurrentUser() user: JwtPayload,
    @Query('dispositivoId') dispositivoId?: string,
  ) {
    return this.monitoreoSvc.getUmbrales(user.empresaId, dispositivoId);
  }

  // ── POST /monitoreo/umbrales ─────────────────────────────────
  @Post('umbrales')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Crear umbral de alerta' })
  createUmbral(@Body() dto: CreateUmbralDto, @CurrentUser() user: JwtPayload) {
    return this.monitoreoSvc.createUmbral(dto, user.empresaId);
  }

  // ── PATCH /monitoreo/umbrales/:id ────────────────────────────
  @Patch('umbrales/:id')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Actualizar umbral de alerta' })
  updateUmbral(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: Partial<CreateUmbralDto>,
  ) {
    return this.monitoreoSvc.updateUmbral(id, user.empresaId, dto);
  }

  // ── DELETE /monitoreo/umbrales/:id ───────────────────────────
  @Delete('umbrales/:id')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Eliminar umbral de alerta' })
  deleteUmbral(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.monitoreoSvc.deleteUmbral(id, user.empresaId);
  }

}
