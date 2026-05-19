import {
  Controller, Get, Post, Patch, Body, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles }       from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SistemaService, CronHorarios } from './sistema.service';

@ApiTags('Sistema — Admin')
@ApiBearerAuth('JWT')
@Roles('Administrador')
@Controller('admin/sistema')
export class SistemaController {
  private readonly logger = new Logger(SistemaController.name);

  constructor(private readonly sistema: SistemaService) {}

  // ── GET /admin/sistema/info ───────────────────────────────────
  @Get('info')
  @ApiOperation({ summary: 'Versión, estado de procesos y recursos del servidor' })
  async getInfo() {
    const info = await this.sistema.getServerInfo();
    return ApiResponse.ok(info);
  }

  // ── GET /admin/sistema/update-log ────────────────────────────
  @Get('update-log')
  @ApiOperation({ summary: 'Log de la última actualización ejecutada' })
  async getUpdateLog() {
    const log = await this.sistema.getUpdateLog();
    return ApiResponse.ok({ log });
  }

  // ── POST /admin/sistema/restart ──────────────────────────────
  @Post('restart')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Reiniciar todos los procesos PM2' })
  restart() {
    this.sistema.triggerRestart();
    return ApiResponse.ok(
      null,
      'Reinicio iniciado — el servidor se reiniciará en unos segundos',
    );
  }

  // ── POST /admin/sistema/update ───────────────────────────────
  @Post('update')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Descargar e instalar la última actualización' })
  update() {
    this.sistema.triggerUpdate();
    return ApiResponse.ok(
      null,
      'Actualización iniciada en background — el servidor se reiniciará al terminar',
    );
  }

  // ── GET /admin/sistema/crontab ───────────────────────────────
  @Get('crontab')
  @ApiOperation({ summary: 'Obtener horarios de tareas programadas' })
  async getCrontab(@CurrentUser() user: JwtPayload) {
    const horarios = await this.sistema.getCronHorarios(user.empresaId);
    return ApiResponse.ok(horarios);
  }

  // ── PATCH /admin/sistema/crontab ─────────────────────────────
  @Patch('crontab')
  @ApiOperation({ summary: 'Actualizar horarios de tareas programadas' })
  async updateCrontab(
    @Body() body: Partial<CronHorarios>,
    @CurrentUser() user: JwtPayload,
  ) {
    const horarios = await this.sistema.updateCronHorarios(user.empresaId, body);
    return ApiResponse.ok(horarios, 'Horarios actualizados');
  }
}
