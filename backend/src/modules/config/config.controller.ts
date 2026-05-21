import {
  Controller, Get, Put, Post,
  Body, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse }             from '../../common/dto/response.dto';
import { ConfigEmpresaService, UpdateEmpresaDto } from './config-empresa.service';

@ApiTags('Configuración')
@ApiBearerAuth('JWT')
@Controller('config')
export class ConfigController {
  constructor(private readonly svc: ConfigEmpresaService) {}

  @Get('empresa')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Obtener datos de la empresa' })
  async getEmpresa(@CurrentUser() user: JwtPayload) {
    const empresa = await this.svc.getEmpresa(user.empresaId);
    return ApiResponse.ok(empresa);
  }

  @Put('empresa')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Actualizar datos de la empresa' })
  async updateEmpresa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEmpresaDto,
  ) {
    const empresa = await this.svc.updateEmpresa(user.empresaId, dto);
    return ApiResponse.ok(empresa, 'Configuración guardada');
  }

  @Post('empresa/logo')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Subir logo de la empresa' })
  @UseInterceptors(FileInterceptor('logo', {
    storage: memoryStorage(),
    limits:  { fileSize: 2 * 1024 * 1024 },
  }))
  async uploadLogo(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.svc.uploadLogo(user.empresaId, file);
    return ApiResponse.ok(result, 'Logo actualizado');
  }
}
