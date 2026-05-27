// Ruta: /opt/datafast/backend/src/modules/monitoreo/monitoreo.controller.ts

import {
  Body, Controller, Get, Param,
  ParseUUIDPipe, Post,
}                            from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { MonitoreoService, ProbarConexionDto } from './monitoreo.service';
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
  @RequirePermission('monitoreo:leer')
  @ApiOperation({ summary: 'Estado en tiempo real de todos los dispositivos' })
  getTiempoReal(@CurrentUser() user: JwtPayload) {
    return this.monitoreoSvc.getTiempoReal(user.empresaId);
  }

  // ── GET /monitoreo/dispositivos/:id/clientes ─────────────────
  // MACs conectadas en vivo (solo ANTENA_AP MikroTik)
  @Get('dispositivos/:id/clientes')
  @RequirePermission('monitoreo:leer')
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
  @RequirePermission('monitoreo:leer')
  @ApiOperation({ summary: 'Prueba rápida de credenciales MikroTik (no guarda datos)' })
  probarConexion(@Body() dto: ProbarConexionDto) {
    return this.monitoreoSvc.probarConexion(dto);
  }
}
