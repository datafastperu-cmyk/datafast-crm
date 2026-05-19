import {
  Controller, Get, Post, Delete, Query, Param, Body,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuditoriaService } from './auditoria.service';
import { FiltrosAuditoriaDto, RestaurarDto, EliminarPermanenteDto } from './dto/auditoria.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Auditoría')
@ApiBearerAuth()
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly svc: AuditoriaService) {}

  // ── Historial de logs ─────────────────────────────────────────
  @Get('logs')
  getLogs(
    @CurrentUser() user: JwtPayload,
    @Query() filtros: FiltrosAuditoriaDto,
  ) {
    return this.svc.getLogs(user.empresaId, filtros);
  }

  // ── Estado undo/redo para el usuario actual ───────────────────
  @Get('estado')
  getEstado(@CurrentUser() user: JwtPayload) {
    return this.svc.getEstado(user.sub, user.empresaId);
  }

  // ── Undo ──────────────────────────────────────────────────────
  @Post('undo')
  @HttpCode(HttpStatus.OK)
  undo(@CurrentUser() user: JwtPayload) {
    return this.svc.undo(user.sub, user.empresaId);
  }

  // ── Redo ──────────────────────────────────────────────────────
  @Post('redo')
  @HttpCode(HttpStatus.OK)
  redo(@CurrentUser() user: JwtPayload) {
    return this.svc.redo(user.sub, user.empresaId);
  }

  // ── Papelera ──────────────────────────────────────────────────
  @Get('papelera')
  getPapelera(
    @CurrentUser() user: JwtPayload,
    @Query('modulo') modulo?: string,
  ) {
    return this.svc.getPapelera(user.empresaId, modulo);
  }

  @Post('papelera/restaurar')
  @HttpCode(HttpStatus.OK)
  restaurar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RestaurarDto,
  ) {
    return this.svc.restaurar(dto.tabla, dto.id, user.empresaId);
  }

  @Delete('papelera/eliminar')
  @Roles('admin', 'superadmin')
  @HttpCode(HttpStatus.OK)
  eliminarPermanente(
    @CurrentUser() user: JwtPayload,
    @Body() dto: EliminarPermanenteDto,
  ) {
    return this.svc.eliminarPermanente(dto.tabla, dto.id, user.empresaId);
  }

  // ── Historial de una entidad específica ───────────────────────
  @Get('entidad/:tabla/:id')
  getHistorialEntidad(
    @CurrentUser() user: JwtPayload,
    @Param('tabla') tabla: string,
    @Param('id')    id:    string,
  ) {
    return this.svc.getHistorialEntidad(tabla, id, user.empresaId);
  }

  // ── Restaurar versión específica ──────────────────────────────
  @Post('version/:id/restaurar')
  @HttpCode(HttpStatus.OK)
  restaurarVersion(
    @CurrentUser() user: JwtPayload,
    @Param('id')    id:  string,
  ) {
    return this.svc.restaurarVersion(id, user.sub, user.empresaId);
  }
}
