import {
  Controller, Get, Post, Param, Query,
  Res, HttpCode, UseGuards, BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response }           from 'express';
import { JwtAuthGuard }       from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RedOnusService, ListarOnusFilters } from './red-onus.service';

@Controller('red')
@UseGuards(JwtAuthGuard)
export class RedController {

  constructor(private readonly onusService: RedOnusService) {}

  // ─── GET /red/onus/export  (DEBE ir ANTES de /red/onus/:sn) ──
  @Get('onus/export')
  async exportCsv(
    @CurrentUser() user: JwtPayload,
    @Query('oltId')   oltId?:   string,
    @Query('estado')  estado?:  string,
    @Query('zonaId')  zonaId?:  string,
    @Query('q')       q?:       string,
    @Res() res?: Response,
  ) {
    const filters: ListarOnusFilters = { oltId, estado, zonaId, q };
    const csv = await this.onusService.exportCsv(user.empresaId, filters);
    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', `attachment; filename="onus-${Date.now()}.csv"`);
    res!.send('﻿' + csv);  // BOM para Excel en Windows
  }

  // ─── POST /red/onus/señal-batch  (DEBE ir ANTES de /:sn) ──────
  @Post('onus/señal-batch')
  @HttpCode(202)
  async batchSenal(
    @CurrentUser() user: JwtPayload,
    @Query('sns') snsRaw?: string,
  ) {
    const sns = (snsRaw ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (sns.length === 0) throw new BadRequestException('Se requiere al menos un SN');
    if (sns.length > 50)  throw new BadRequestException('Máximo 50 SNs por batch');
    return this.onusService.iniciarBatchSenal(sns, user.empresaId);
  }

  // ─── GET /red/onus ───────────────────────────────────────────
  @Get('onus')
  async listar(
    @CurrentUser() user: JwtPayload,
    @Query('page')   page?:   string,
    @Query('limit')  limit?:  string,
    @Query('oltId')  oltId?:  string,
    @Query('estado') estado?: string,
    @Query('zonaId') zonaId?: string,
    @Query('calidad') calidad?: string,
    @Query('q')      q?:      string,
    @Query('sort')   sort?:   string,
    @Query('dir')    dir?:    string,
  ) {
    const filters: ListarOnusFilters = {
      page:   page  ? Number(page)  : 1,
      limit:  limit ? Number(limit) : 50,
      oltId, estado, zonaId, calidad, q, sort,
      dir: (dir === 'DESC' ? 'DESC' : 'ASC'),
    };
    return this.onusService.listar(user.empresaId, filters);
  }

  // ─── POST /red/onus/:sn/señal ────────────────────────────────
  @Post('onus/:sn/señal')
  async refreshSenal(
    @CurrentUser() user: JwtPayload,
    @Param('sn') sn: string,
  ) {
    return this.onusService.refreshSenal(sn, user.empresaId);
  }

  // ─── POST /red/onus/:sn/suspender ───────────────────────────
  @Post('onus/:sn/suspender')
  async suspender(
    @CurrentUser() user: JwtPayload,
    @Param('sn') sn: string,
  ) {
    return this.onusService.suspender(sn, user.empresaId);
  }

  // ─── POST /red/onus/:sn/rehabilitar ─────────────────────────
  @Post('onus/:sn/rehabilitar')
  async rehabilitar(
    @CurrentUser() user: JwtPayload,
    @Param('sn') sn: string,
  ) {
    return this.onusService.rehabilitar(sn, user.empresaId);
  }

  // ─── POST /red/onus/:sn/resetear ────────────────────────────
  @Post('onus/:sn/resetear')
  async resetear(
    @CurrentUser() user: JwtPayload,
    @Param('sn') sn: string,
  ) {
    return this.onusService.resetear(sn, user.empresaId);
  }

  // ─── GET /red/onus/:sn/version ──────────────────────────────
  @Get('onus/:sn/version')
  async getVersion(
    @CurrentUser() user: JwtPayload,
    @Param('sn') sn: string,
  ) {
    return this.onusService.getVersion(sn, user.empresaId);
  }
}
