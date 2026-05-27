import {
  Controller, Get, Query, Res, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';

import { ReportesService }    from './reportes.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Reportes')
@ApiBearerAuth('JWT')
@Controller('reportes')
export class ReportesController {
  constructor(private readonly svc: ReportesService) {}

  @Get('resumen')
  @RequirePermission('reports:view')
  @ApiOperation({ summary: 'KPIs generales del sistema' })
  async resumenGeneral(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getResumenGeneral(user.empresaId));
  }

  @Get('cobranza')
  @RequirePermission('reports:financial')
  @ApiOperation({ summary: 'Reporte de cobranza mensual' })
  async cobranza(
    @Query('mes')  mes:  string,
    @Query('anio') anio: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const now = new Date();
    const m = parseInt(mes  || String(now.getMonth() + 1), 10);
    const a = parseInt(anio || String(now.getFullYear()),   10);
    return StdResponse.ok(await this.svc.getCobranza(user.empresaId, m, a));
  }

  @Get('clientes')
  @RequirePermission('reports:view')
  @ApiOperation({ summary: 'Reporte de clientes por período' })
  async clientes(
    @Query('mes')  mes:  string,
    @Query('anio') anio: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const now = new Date();
    const m = parseInt(mes  || String(now.getMonth() + 1), 10);
    const a = parseInt(anio || String(now.getFullYear()),   10);
    return StdResponse.ok(await this.svc.getClientes(user.empresaId, m, a));
  }

  @Get('red')
  @RequirePermission('reports:view')
  @ApiOperation({ summary: 'Reporte de red y monitoreo' })
  async red(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getRed(user.empresaId));
  }

  @Get('cobranza/exportar')
  @RequirePermission('reports:export')
  @ApiOperation({ summary: 'Exportar reporte de cobranza CSV' })
  async exportarCobranza(
    @Query('mes')  mes:  string,
    @Query('anio') anio: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const now = new Date();
    const m = parseInt(mes  || String(now.getMonth() + 1), 10);
    const a = parseInt(anio || String(now.getFullYear()),   10);
    const csv = await this.svc.exportarCobranzaCsv(user.empresaId, m, a);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cobranza-${m}-${a}.csv"`);
    res.send('﻿' + csv); // BOM for Excel UTF-8
  }

  @Get('clientes/exportar')
  @RequirePermission('reports:export')
  @ApiOperation({ summary: 'Exportar reporte de clientes CSV' })
  async exportarClientes(
    @Query('mes')  mes:  string,
    @Query('anio') anio: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const now = new Date();
    const m = parseInt(mes  || String(now.getMonth() + 1), 10);
    const a = parseInt(anio || String(now.getFullYear()),   10);
    // Reuse cobranza export for now — extend if needed
    const csv = await this.svc.exportarCobranzaCsv(user.empresaId, m, a);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clientes-${m}-${a}.csv"`);
    res.send('﻿' + csv);
  }
}
