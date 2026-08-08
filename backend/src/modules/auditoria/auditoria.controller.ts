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

  // ── Cifras de cabecera y catálogo de filtros del Log ──────────
  @Get('resumen')
  getResumen(@CurrentUser() user: JwtPayload) {
    return this.svc.getResumen(user.empresaId);
  }

  // ── Estado undo/redo para el usuario actual ───────────────────
  @Get('estado')
  getEstado(@CurrentUser() user: JwtPayload) {
    return this.svc.getEstado(user.sub, user.empresaId);
  }

  // ── Undo ──────────────────────────────────────────────────────
  // Deshacer alcanza CUALQUIER tabla del sistema. Estaba sin autorización: `RolesGuard` deja
  // pasar cuando no hay ni `@Roles` ni `@RequirePermission`, así que cualquier usuario
  // autenticado podía revertir operaciones ajenas — incluido un rol de «Atención al Cliente»
  // (desviación B-3, medido contra el código el 2026-08-08).
  @Post('undo')
  @Roles('Administrador', 'Super Administrador')
  @HttpCode(HttpStatus.OK)
  undo(@CurrentUser() user: JwtPayload) {
    return this.svc.undo(user.sub, user.empresaId);
  }

  // ── Redo ──────────────────────────────────────────────────────
  @Post('redo')
  @Roles('Administrador', 'Super Administrador')
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
  @Roles('Administrador', 'Super Administrador')
  @HttpCode(HttpStatus.OK)
  restaurar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RestaurarDto,
  ) {
    return this.svc.restaurar(dto.tabla, dto.id, user.empresaId);
  }

  @Delete('papelera/eliminar')
  // Decía @Roles('admin', 'superadmin'): DOS ROLES QUE NO EXISTEN. Los reales se llaman
  // 'Administrador' y 'Super Administrador', así que este endpoint era INALCANZABLE para
  // todo el mundo — nadie podía purgar la papelera. Falla cerrado, que es la dirección
  // segura, pero era una función muerta sin que nada lo dijera (2026-08-08).
  @Roles('Administrador', 'Super Administrador')
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
  @Roles('Administrador', 'Super Administrador')
  @HttpCode(HttpStatus.OK)
  restaurarVersion(
    @CurrentUser() user: JwtPayload,
    @Param('id')    id:  string,
  ) {
    return this.svc.restaurarVersion(id, user.sub, user.empresaId);
  }
}
