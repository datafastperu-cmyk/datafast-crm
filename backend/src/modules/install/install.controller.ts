import {
  Controller, Get, Post, Body,
  HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { InstallService, DbConfigDto, ActivateLicenseDto } from './install.service';
import { Public } from '../../common/decorators/public.decorator';

class TestDbDto implements DbConfigDto {
  @IsString() @IsNotEmpty() host: string;
  @IsNotEmpty() port: number;
  @IsString() @IsNotEmpty() username: string;
  @IsString() password: string;
  @IsString() @IsNotEmpty() database: string;
}

class ActivateDto implements ActivateLicenseDto {
  @IsEmail() email: string;
  @IsOptional() @IsString() licenseKey: string;
}

@ApiTags('Install')
@Controller('install')
@Public()
export class InstallController {
  private readonly logger = new Logger(InstallController.name);

  constructor(private readonly installSvc: InstallService) {}

  // GET /api/v1/install/status
  @Get('status')
  @ApiOperation({ summary: 'Estado de la instalación' })
  getStatus() {
    return this.installSvc.getStatus();
  }

  // GET /api/v1/install/db-config
  @Get('db-config')
  @ApiOperation({ summary: 'Configuración de BD actual (desde .env)' })
  getDbConfig() {
    this.installSvc.assertNotInstalled();
    const cfg = this.installSvc.getCurrentDbConfig();
    // No exponer la contraseña completa, solo confirmar si está configurada
    return {
      host:               cfg.host,
      port:               cfg.port,
      username:           cfg.username,
      passwordConfigured: !!cfg.password,
      database:           cfg.database,
    };
  }

  // POST /api/v1/install/test-db
  @Post('test-db')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probar conexión a base de datos' })
  async testDb(@Body() dto: TestDbDto) {
    this.installSvc.assertNotInstalled();
    return this.installSvc.testDbConnection(dto);
  }

  // POST /api/v1/install/activate
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar licencia y finalizar instalación' })
  async activate(@Body() dto: ActivateDto) {
    this.installSvc.assertNotInstalled();
    return this.installSvc.activateAndFinalize(dto);
  }
}
