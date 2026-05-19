import {
  Controller, Get, Post, Delete, Patch,
  Param, Body, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles }       from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { BackupService, BackupConfig } from './backup.service';
import { TipoBackup } from './backup.entity';

@ApiTags('Backup — Admin')
@ApiBearerAuth('JWT')
@Roles('Administrador')
@Controller('admin/backup')
export class BackupController {
  constructor(private readonly svc: BackupService) {}

  @Get('config')
  @ApiOperation({ summary: 'Obtener configuración de backup' })
  async getConfig(@CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.getConfig(user.empresaId));
  }

  @Patch('config')
  @ApiOperation({ summary: 'Actualizar configuración de backup' })
  async updateConfig(
    @CurrentUser() user: JwtPayload,
    @Body() body: Partial<BackupConfig>,
  ) {
    return ApiResponse.ok(
      await this.svc.updateConfig(user.empresaId, body),
      'Configuración actualizada',
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar backups' })
  async listar(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    return ApiResponse.ok(
      await this.svc.listar(user.empresaId, +limit, +offset),
    );
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ejecutar backup manual' })
  async crear(@CurrentUser() user: JwtPayload) {
    const backup = await this.svc.crearBackup(
      user.empresaId,
      TipoBackup.MANUAL,
      user.email || user.sub,
    );
    return ApiResponse.ok(backup, 'Backup iniciado');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener backup por ID (incluye logs)' })
  async obtener(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return ApiResponse.ok(await this.svc.obtener(id, user.empresaId));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar backup' })
  async eliminar(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.svc.eliminar(id, user.empresaId);
    return ApiResponse.ok(null, 'Backup eliminado');
  }
}
